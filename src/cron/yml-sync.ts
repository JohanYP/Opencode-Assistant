import fs from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { logger } from "../utils/logger.js";
import { getCronYmlPath } from "../memory/manager.js";
import { startCronYmlWatcher, stopCronYmlWatcher } from "../memory/watcher.js";
import {
  addScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
  replaceScheduledTasks,
} from "../scheduled-task/store.js";
import type { ScheduledCronTask, ScheduledOnceTask, ScheduledTask } from "../scheduled-task/types.js";
import { computeNextRunAt } from "../scheduled-task/next-run.js";
import { config } from "../config.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";

// Types for cron.yml entries
interface CronYmlEntry {
  id: string;
  schedule: string;
  prompt?: string;
  message?: string;
  type?: "task" | "reminder" | "backup";
  timezone?: string;
}

interface CronYmlFile {
  crons?: CronYmlEntry[];
}

const DEFAULT_MODEL = {
  providerID: config.opencode.model.provider,
  modelID: config.opencode.model.modelId,
  variant: null,
};

const DEFAULT_WORKTREE = process.env.MEMORY_DIR
  ? path.resolve(process.env.MEMORY_DIR, "..")
  : process.cwd();

// IDs managed by cron.yml (to distinguish from /task-created ones)
const YML_ID_PREFIX = "yml-";

function makeYmlId(entryId: string): string {
  return `${YML_ID_PREFIX}${entryId}`;
}

function isYmlTask(task: ScheduledTask): boolean {
  return task.id.startsWith(YML_ID_PREFIX);
}

/**
 * Reads and parses memory/cron.yml.
 * Returns an empty list if the file doesn't exist or is invalid.
 */
async function readCronYml(): Promise<CronYmlEntry[]> {
  try {
    const content = await fs.readFile(getCronYmlPath(), "utf-8");
    const parsed = yaml.load(content) as CronYmlFile | null;
    return parsed?.crons ?? [];
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    logger.warn("[CronYmlSync] Failed to parse cron.yml:", error);
    return [];
  }
}

/**
 * Writes current /task-created cron tasks back to cron.yml,
 * preserving any yml-originated entries that still exist in the store.
 */
export async function writeCronYml(tasks: ScheduledTask[]): Promise<void> {
  try {
    const cronEntries: CronYmlEntry[] = tasks
      .filter((t) => t.kind === "cron")
      .map((t) => {
        const entry: CronYmlEntry = {
          id: t.id.startsWith(YML_ID_PREFIX) ? t.id.slice(YML_ID_PREFIX.length) : t.id,
          schedule: (t as ScheduledCronTask).cron,
          timezone: t.timezone,
        };
        if (t.prompt) {
          entry.prompt = t.prompt;
        }
        return entry;
      });

    const content = yaml.dump({ crons: cronEntries }, { indent: 2 });
    await fs.mkdir(path.dirname(getCronYmlPath()), { recursive: true });
    await fs.writeFile(getCronYmlPath(), content, "utf-8");
    logger.debug(`[CronYmlSync] Wrote cron.yml (${cronEntries.length} entries)`);
  } catch (error) {
    logger.error("[CronYmlSync] Failed to write cron.yml:", error);
  }
}

/**
 * Loads cron.yml and syncs its entries into the scheduled-task store.
 * Only adds entries that don't already exist (by yml- prefixed id).
 * Removes yml-managed tasks that are no longer in the file.
 */
export async function syncFromYml(): Promise<void> {
  if (!config.cron.ymlSync) {
    return;
  }

  const ymlEntries = await readCronYml();
  const existingTasks = listScheduledTasks();
  const existingYmlIds = new Set(
    existingTasks.filter(isYmlTask).map((t) => t.id),
  );
  const ymlIds = new Set(ymlEntries.map((e) => makeYmlId(e.id)));

  // Remove yml tasks that are no longer in the file
  for (const task of existingTasks) {
    if (isYmlTask(task) && !ymlIds.has(task.id)) {
      await removeScheduledTask(task.id);
      scheduledTaskRuntime.removeTask(task.id);
      logger.info(`[CronYmlSync] Removed stale yml task: ${task.id}`);
    }
  }

  // Add new yml entries that don't exist in the store
  const now = new Date();
  for (const entry of ymlEntries) {
    const taskId = makeYmlId(entry.id);

    if (existingYmlIds.has(taskId)) {
      continue;
    }

    if (entry.type === "backup") {
      // Backup tasks are handled by the reminder module
      continue;
    }

    const timezone = entry.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const prompt = entry.prompt ?? entry.message ?? "";

    try {
      const task: ScheduledCronTask = {
        id: taskId,
        kind: "cron",
        cron: entry.schedule,
        projectId: "default",
        projectWorktree: DEFAULT_WORKTREE,
        model: { ...DEFAULT_MODEL },
        scheduleText: entry.schedule,
        scheduleSummary: entry.schedule,
        timezone,
        prompt,
        createdAt: now.toISOString(),
        nextRunAt: computeNextRunAt(
          { kind: "cron", cron: entry.schedule, timezone } as ScheduledCronTask,
          now,
        ),
        lastRunAt: null,
        runCount: 0,
        lastStatus: "idle",
        lastError: null,
      };

      await addScheduledTask(task);
      scheduledTaskRuntime.registerTask(task);
      logger.info(`[CronYmlSync] Added yml task: ${taskId} (${entry.schedule})`);
    } catch (error) {
      logger.warn(`[CronYmlSync] Failed to add yml task ${taskId}:`, error);
    }
  }
}

/**
 * Starts the cron.yml watcher and performs an initial sync.
 */
export async function startCronYmlSync(): Promise<void> {
  if (!config.cron.ymlSync) {
    return;
  }

  await syncFromYml();

  startCronYmlWatcher(async () => {
    logger.info("[CronYmlSync] cron.yml changed, re-syncing...");
    await syncFromYml();
  });

  logger.info("[CronYmlSync] Cron.yml sync started");
}

/**
 * Stops the cron.yml watcher.
 */
export function stopCronYmlSync(): void {
  stopCronYmlWatcher();
}

/**
 * Called when a task is created or deleted via /task in Telegram.
 * Updates cron.yml to reflect the current store state.
 */
export async function syncToYml(): Promise<void> {
  if (!config.cron.ymlSync) {
    return;
  }
  const tasks = listScheduledTasks();
  await writeCronYml(tasks);
}
