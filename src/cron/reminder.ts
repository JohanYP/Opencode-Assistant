import type { Bot, Context } from "grammy";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { backupMemory } from "../memory/manager.js";
import { sendBotText } from "../bot/utils/telegram-text.js";

// Reminder tasks: send a message directly to Telegram without creating an OpenCode session.
// Backup tasks: copy memory files to memory/backups/YYYY-MM-DD/.

export interface ReminderTask {
  id: string;
  kind: "reminder";
  cron: string;
  message: string;
  timezone: string;
}

export interface BackupTask {
  id: string;
  kind: "backup";
  cron: string;
  timezone: string;
}

export type SpecialTask = ReminderTask | BackupTask;

let botRef: Bot<Context> | null = null;

export function setReminderBot(bot: Bot<Context>): void {
  botRef = bot;
}

/**
 * Sends a reminder message directly to the allowed user via Telegram.
 */
export async function sendReminder(message: string): Promise<void> {
  if (!botRef) {
    logger.warn("[Reminder] Bot not set, cannot send reminder");
    return;
  }

  try {
    await sendBotText({
      api: botRef.api,
      chatId: config.telegram.allowedUserId,
      text: message,
      format: "raw",
    });
    logger.info("[Reminder] Sent reminder message");
  } catch (error) {
    logger.error("[Reminder] Failed to send reminder:", error);
  }
}

/**
 * Runs an automatic memory backup and notifies the user.
 */
export async function runMemoryBackup(): Promise<void> {
  if (!botRef) {
    logger.warn("[Reminder] Bot not set, cannot notify backup result");
  }

  try {
    const backupPath = await backupMemory();
    logger.info(`[Reminder] Memory backup completed: ${backupPath}`);

    if (botRef) {
      await sendBotText({
        api: botRef.api,
        chatId: config.telegram.allowedUserId,
        text: `Memory backup completed: ${backupPath}`,
        format: "raw",
      });
    }
  } catch (error) {
    logger.error("[Reminder] Memory backup failed:", error);

    if (botRef) {
      await sendBotText({
        api: botRef.api,
        chatId: config.telegram.allowedUserId,
        text: `Memory backup failed: ${error instanceof Error ? error.message : String(error)}`,
        format: "raw",
      });
    }
  }
}
