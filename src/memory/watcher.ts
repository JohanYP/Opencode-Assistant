import fs from "node:fs";
import { logger } from "../utils/logger.js";
import { getCronYmlPath, getSessionSummaryPath } from "./manager.js";
import { clearSessionTracker } from "./session-tracker.js";

type CronYmlChangeCallback = () => void | Promise<void>;

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 500;

// ── session-summary.md watcher ───────────────────────────────────────────────
let summaryWatcher: fs.FSWatcher | null = null;
let summaryDebounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Starts watching memory/cron.yml for changes.
 * Calls the callback with debounce when the file changes.
 */
export function startCronYmlWatcher(onChange: CronYmlChangeCallback): void {
  const cronYmlPath = getCronYmlPath();

  if (watcher) {
    stopCronYmlWatcher();
  }

  try {
    watcher = fs.watch(cronYmlPath, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }

      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        logger.info("[MemoryWatcher] cron.yml changed, syncing...");
        Promise.resolve(onChange()).catch((err) => {
          logger.error("[MemoryWatcher] Error in cron.yml change callback:", err);
        });
      }, DEBOUNCE_MS);
    });

    watcher.on("error", (err) => {
      logger.warn("[MemoryWatcher] Watcher error:", err);
    });

    logger.info(`[MemoryWatcher] Watching ${cronYmlPath}`);
  } catch (error) {
    // cron.yml may not exist yet — that's fine, sync will create it
    logger.debug(`[MemoryWatcher] Could not watch cron.yml (may not exist yet):`, error);
  }
}

export function stopCronYmlWatcher(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (watcher) {
    watcher.close();
    watcher = null;
    logger.debug("[MemoryWatcher] Stopped watching cron.yml");
  }
}

// ── session-summary.md watcher ───────────────────────────────────────────────

/**
 * Watches session-summary.md for changes written by the LLM.
 * When the file changes, clears the session tracker so the next new session
 * will receive the updated summary as its first-message context.
 */
export function startMemorySummaryWatcher(): void {
  const summaryPath = getSessionSummaryPath();

  if (summaryWatcher) {
    stopMemorySummaryWatcher();
  }

  try {
    summaryWatcher = fs.watch(summaryPath, (eventType) => {
      if (eventType !== "change" && eventType !== "rename") {
        return;
      }

      if (summaryDebounceTimer) {
        clearTimeout(summaryDebounceTimer);
      }

      summaryDebounceTimer = setTimeout(() => {
        summaryDebounceTimer = null;
        logger.debug("[MemoryWatcher] session-summary.md changed, clearing session tracker");
        // Clear tracker so the NEXT new session gets the updated summary
        clearSessionTracker();
      }, DEBOUNCE_MS);
    });

    summaryWatcher.on("error", (err) => {
      logger.warn("[MemoryWatcher] Summary watcher error:", err);
    });

    logger.debug(`[MemoryWatcher] Watching session-summary.md`);
  } catch (error) {
    // File may not exist yet — created on first session
    logger.debug("[MemoryWatcher] Could not watch session-summary.md (may not exist yet):", error);
  }
}

export function stopMemorySummaryWatcher(): void {
  if (summaryDebounceTimer) {
    clearTimeout(summaryDebounceTimer);
    summaryDebounceTimer = null;
  }

  if (summaryWatcher) {
    summaryWatcher.close();
    summaryWatcher = null;
    logger.debug("[MemoryWatcher] Stopped watching session-summary.md");
  }
}
