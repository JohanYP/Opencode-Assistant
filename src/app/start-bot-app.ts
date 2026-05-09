import fs from "node:fs/promises";
import { readFile } from "node:fs/promises";

import { cleanupBotRuntime, createBot } from "../bot/index.js";
import { config } from "../config.js";
import { opencodeAutoRestartService } from "../opencode/auto-restart.js";
import { loadSettings } from "../settings/manager.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { registerReminderTarget, setReminderBot } from "../cron/reminder.js";
import { startCronYmlSync, stopCronYmlSync } from "../cron/yml-sync.js";
import { startWhatsApp, stopWhatsApp } from "../whatsapp/runtime.js";
import { warmupSessionDirectoryCache } from "../session/cache-manager.js";
import { reconcileStoredModelSelection } from "../model/manager.js";
import { startMemorySummaryWatcher, stopMemorySummaryWatcher } from "../memory/watcher.js";
import { migrateFromFiles, syncIdentityDocumentsFromFiles } from "../memory/migrate-from-files.js";
import { closeDb } from "../memory/db.js";
import { startMcpHttpServer, type McpHttpServerHandle } from "../mcp/http-server.js";
import { getRuntimeMode } from "../runtime/mode.js";
import { getRuntimePaths, migrateLegacyAppHome } from "../runtime/paths.js";
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
  // Move state from the previous "opencode-telegram-bot" config directory
  // into "opencode-assistant" before anything else touches the filesystem.
  // Idempotent: no-op once the new dir exists or no legacy dir is present.
  let legacyMigrationNote: string | null = null;
  try {
    const legacy = migrateLegacyAppHome();
    if (legacy.migrated) {
      legacyMigrationNote = `Moved legacy config dir ${legacy.legacyPath} -> ${legacy.newPath}`;
    }
  } catch (error) {
    legacyMigrationNote = `Legacy config-dir migration failed (continuing): ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  await initializeLogger();

  if (legacyMigrationNote) {
    logger.info(`[App] ${legacyMigrationNote}`);
  }

  const mode = getRuntimeMode();
  const runtimePaths = getRuntimePaths();
  const version = await getBotVersion();
  const logFilePath = getLogFilePath();

  logger.info(`Starting Opencode-Assistant v${version}...`);
  logger.info(`Config loaded from ${runtimePaths.envFilePath}`);
  if (logFilePath) {
    logger.info(`Logs are written to ${logFilePath}`);
  }
  // Channel modes are explicit so users see at a glance which surfaces are
  // active. "WhatsApp-only" is a supported mode as of v1.x — Telegram is
  // optional but at least one channel must be configured (validated in
  // src/config.ts).
  if (config.telegram.enabled && config.whatsapp.enabled) {
    logger.info(`Channels: Telegram (user ${config.telegram.allowedUserId}) + WhatsApp`);
  } else if (config.telegram.enabled) {
    logger.info(`Channels: Telegram only (user ${config.telegram.allowedUserId})`);
  } else {
    logger.info("Channels: WhatsApp only (Telegram not configured)");
  }
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

  // Telegram bot is now optional — only create it when configured.
  const telegramBot = config.telegram.enabled ? createBot() : null;
  if (telegramBot) {
    setReminderBot(telegramBot);
    await scheduledTaskRuntime.initialize(telegramBot);
  } else {
    logger.info(
      "[App] Telegram disabled — scheduled task delivery is unavailable in this mode. " +
        "Reminders still fire on the WhatsApp channel via cron/reminder.ts.",
    );
  }
  await startCronYmlSync();

  // WhatsApp is a second optional channel. start() handles the disabled
  // case and only fails soft (logs, returns null) so a misconfigured
  // WhatsApp doesn't take Telegram down with it. Once it connects, register
  // it as a reminder target so cron-driven reminders and memory backup
  // notifications fan out to both channels.
  void startWhatsApp()
    .then((whatsappBot) => {
      if (whatsappBot && config.whatsapp.allowedNumber) {
        registerReminderTarget({
          platform: "whatsapp",
          bot: whatsappBot,
          jid: config.whatsapp.allowedNumber,
        });
      }
    })
    .catch((err) => {
      logger.error("[App] WhatsApp startup error (continuing without it)", err);
    });

  let shutdownStarted = false;
  let serviceStateCleared = false;
  let shutdownTimeout: ReturnType<typeof setTimeout> | null = null;
  // When running WhatsApp-only there's no `bot.start()` blocking call to
  // keep the process alive. We use this promise as the main-loop instead:
  // it resolves when the shutdown handler fires, mirroring how grammy's
  // long-polling exits when bot.stop() is called.
  let resolveStandaloneRun: (() => void) | null = null;
  const standaloneRunComplete = new Promise<void>((resolve) => {
    resolveStandaloneRun = resolve;
  });

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
    void stopWhatsApp().catch((err) => {
      logger.warn("[App] Failed to stop WhatsApp cleanly", err);
    });
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

    if (telegramBot) {
      try {
        telegramBot.stop();
      } catch (error) {
        logger.warn("[App] Failed to stop Telegram bot cleanly", error);
      }
    }

    // Unblock the standalone main-loop (no-op in Telegram mode).
    resolveStandaloneRun?.();
    resolveStandaloneRun = null;

    void clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  };

  const handleSigint = (): void => shutdown("SIGINT");
  const handleSigterm = (): void => shutdown("SIGTERM");
  process.on("SIGINT", handleSigint);
  process.on("SIGTERM", handleSigterm);

  if (telegramBot) {
    const webhookInfo = await telegramBot.api.getWebhookInfo();
    if (webhookInfo.url) {
      logger.info(`[Bot] Webhook detected: ${webhookInfo.url}, removing...`);
      await telegramBot.api.deleteWebhook();
      logger.info("[Bot] Webhook removed, switching to long polling");
    }
  }

  try {
    if (telegramBot) {
      // Telegram path: long-poll until bot.stop() is called by shutdown().
      await telegramBot.start({
        onStart: (botInfo) => {
          logger.info(`Bot @${botInfo.username} started!`);
        },
      });
    } else {
      // WhatsApp-only path: WhatsApp's start() returns once Baileys is
      // connected (it's not blocking). Block here on a Promise resolved by
      // the shutdown handler so the process keeps responding to signals
      // while Baileys runs in the background. Without this the process
      // would exit cleanly the moment startBotApp() returned, killing
      // the WhatsApp socket.
      logger.info("[App] WhatsApp-only mode: running until SIGINT/SIGTERM.");
      await standaloneRunComplete;
    }
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
    await stopWhatsApp().catch((err) => {
      logger.warn("[App] Failed to stop WhatsApp cleanly on exit", err);
    });
    await clearManagedServiceState().catch((error) => {
      logger.warn("[App] Failed to clear managed service state", error);
    });
  }
}
