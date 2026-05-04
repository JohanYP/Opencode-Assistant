import fs from "node:fs/promises";
import { readFile } from "node:fs/promises";

import { cleanupBotRuntime, createBot } from "../bot/index.js";
import { config } from "../config.js";
import { opencodeAutoRestartService } from "../opencode/auto-restart.js";
import { loadSettings } from "../settings/manager.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { setReminderBot } from "../cron/reminder.js";
import { startCronYmlSync, stopCronYmlSync } from "../cron/yml-sync.js";
import { warmupSessionDirectoryCache } from "../session/cache-manager.js";
import { reconcileStoredModelSelection } from "../model/manager.js";
import { startMemorySummaryWatcher, stopMemorySummaryWatcher } from "../memory/watcher.js";
import { migrateFromFiles, syncIdentityDocumentsFromFiles } from "../memory/migrate-from-files.js";
import { closeDb } from "../memory/db.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "../mcp/http-server.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { clearServiceStateFile } from "../service/manager.js";
import { getServiceStateFilePathFromEnv, isServiceChildProcess } from "../service/runtime.js";
import { getLogFilePath, initializeLogger, logger } from "../utils/logger.js";

const SHUTDOWN_TIMEOUT_MS = 5000;

async function getBotVersion(): Promise<string> {
  try {
    const packageJsonPath = new URL("../../package.json", import.meta.url);
    const packageJsonContent = await readFile(packageJsonPath, "utf-8");
    const packageJson = JSON.parse(packageJsonContent) as { version?: string };

    return packageJson.version ?? "unknown";
  } catch (error) {
    logger.warn("[App] Failed to read bot version", error);
    return "unknown";
  }
}

export async function startBotApp(): Promise<void> {
  await initializeLogger();

  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const logFilePath = getLogFilePath();

  logger.info(`Starting Opencode-Assistant v${version}...`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  if (logFilePath) {
    logger.info(`Logs are written to ${logFilePath}`);
  }
  logger.info(`Allowed User ID: ${config.telegram.allowedUserId}`);
  logger.debug(`[Runtime] Application start mode: ${mode}`);

  await loadSettings();
  await reconcileStoredModelSelection();
  await opencodeAutoRestartService.start();
  await warmupSessionDirectoryCache();

  // Migrate legacy markdown memory into SQLite on first run. Idempotent —
  // becomes a no-op once the DB has any rows. Backups of the original .md
  // files are kept under memory/.pre-sqlite-backup/.
  try {
    const migration = await migrateFromFiles();
    if (!migration.alreadyMigrated && migration.backupPath) {
      logger.info(
        `[App] Memory migrated to SQLite: ${migration.importedDocuments} doc(s), ` +
          `${migration.importedFacts} fact(s), ${migration.importedSkills} skill(s), ` +
          `${migration.importedScheduledTasks} scheduled task(s). Backup at ${migration.backupPath}.`,
      );
    }
  } catch (error) {
    logger.error("[App] Memory migration failed; continuing with markdown sources:", error);
  }

  // Re-sync the identity documents (soul, agents) from disk on every
  // startup, since those files are intended to be human-edited and
  // version-controlled. This makes \`git pull\` of an updated soul.md
  // actually take effect after a restart instead of silently being
  // shadowed by the older SQLite copy.
  try {
    const sync = await syncIdentityDocumentsFromFiles();
    if (sync.updated.length > 0) {
      logger.info(
        `[App] Refreshed identity documents from files: ${sync.updated.join(", ")}`,
      );
    }
  } catch (error) {
    logger.error("[App] Failed to sync identity documents from files:", error);
  }

  // Start the MCP HTTP server so OpenCode (in its own container on the
  // same compose network) can call our memory tools as a remote MCP server.
  let mcpHttpHandle: McpHttpServerHandle | null = null;
  if (config.mcp.httpEnabled) {
    try {
      mcpHttpHandle = await startMcpHttpServer({
        port: config.mcp.httpPort,
        host: config.mcp.httpHost,
      });
    } catch (error) {
      logger.error(
        `[App] Failed to start MCP HTTP server on ${config.mcp.httpHost}:${config.mcp.httpPort}; ` +
          `OpenCode will not see memory tools until this is resolved.`,
        error,
      );
    }
  }

  // Start watching session-summary.md so that when the LLM updates it
  // mid-session the next new session will receive the updated summary.
  startMemorySummaryWatcher();

  const bot = createBot();
  setReminderBot(bot);
  await scheduledTaskRuntime.initialize(bot);
  await startCronYmlSync();

  let shutdownStarted = false;
  let serviceStateCleared = false;
  let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;

  const clearManagedServiceState = async (): Promise<void> => {
    if (!isServiceChildProcess() || serviceStateCleared) {
      return;
    }

    const stateFilePath = getServiceStateFilePathFromEnv();
    if (!stateFilePath) {
      return;
    }

    try {
      await fs.access(stateFilePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        serviceStateCleared = true;
        return;
      }

      throw error;
    }

    await clearServiceStateFile(stateFilePath);
    serviceStateCleared = true;
  };

  const shutdown = (signal: NodeJS.Signals): void => {
    if (shutdownStarted) {
      return;
    }

    shutdownStarted = true;
    logger.info(`[App] Received ${signal}, shutting down...`);
    cleanupBotRuntime(`app_shutdown_${signal.toLowerCase()}`);
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();
    stopCronYmlSync();
    stopMemorySummaryWatcher();
    if (mcpHttpHandle) {
      void mcpHttpHandle.close().catch((err) => {
        logger.warn("[App] Failed to stop MCP HTTP server cleanly", err);
      });
    }
    closeDb();

    shutdownTimeout = setTimeout(() => {
      logger.warn(`[App] Shutdown did not finish in ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit.`);
      process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    shutdownTimeout.unref?.();

    try {
      bot.stop();
    } catch (error) {
      logger.warn("[App] Failed to stop Telegram bot cleanly", error);
    }

    void clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  };

  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  const webhookInfo = await bot.api.getWebhookInfo();
  if (webhookInfo.url) {
    logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
    await bot.api.deleteWebhook();
    logger.info("[Bot] Webhook removed, switching to long polling");
  }

  try {
    await bot.start({
      onStart: (botInfo) => {
        logger.info(`Bot @${botInfo.username} started!`);
      },
    });
  } finally {
    process.off("SIGINT", handleSigint);
    process.off("SIGTERM", handleSigterm);
    if (shutdownTimeout) {
      clearTimeout(shutdownTimeout);
      shutdownTimeout = null;
    }
    cleanupBotRuntime("app_shutdown_complete");
    opencodeAutoRestartService.stop();
    scheduledTaskRuntime.shutdown();
    stopCronYmlSync();
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  }
}
