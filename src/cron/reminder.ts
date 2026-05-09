import type { Bot, Context } from "grammy";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";
import { backupMemory } from "../memory/manager.js";
import { sendBotText } from "../bot/utils/telegram-text.js";
import type { WhatsAppBot } from "../whatsapp/types.js";

// Reminder tasks: send a message directly to the user without creating an
// OpenCode session. Backup tasks: copy memory files to memory/backups/<date>/.
//
// Multi-channel: this used to hold a single Telegram bot reference. Now it
// keeps a small registry so reminders / backups can fan out to every active
// channel (Telegram + WhatsApp). Registration is push-style — start-bot-app
// calls `registerReminderTarget` for whichever bots came up successfully.

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

type ReminderTarget =
  | { platform: "telegram"; bot: Bot<Context>; chatId: number }
  | { platform: "whatsapp"; bot: WhatsAppBot; jid: string };

const targets: ReminderTarget[] = [];

/**
 * Registers a delivery target. Idempotent per platform — a second register
 * for the same platform replaces the existing one (so reloading the bot
 * doesn't accumulate dead references).
 */
export function registerReminderTarget(target: ReminderTarget): void {
  const idx = targets.findIndex((t) => t.platform === target.platform);
  if (idx >= 0) {
    targets.splice(idx, 1);
  }
  targets.push(target);
  logger.debug(
    `[Reminder] Registered ${target.platform} target (total active=${targets.length})`,
  );
}

export function clearReminderTargets(): void {
  targets.length = 0;
}

/**
 * Backwards-compatible shim. Registers the grammy bot as the Telegram
 * reminder target using the configured allowed user as the chat id.
 * Existing call sites (start-bot-app.ts) keep working unchanged.
 */
export function setReminderBot(bot: Bot<Context>): void {
  registerReminderTarget({
    platform: "telegram",
    bot,
    chatId: config.telegram.allowedUserId,
  });
}

async function sendToTarget(target: ReminderTarget, message: string): Promise<void> {
  if (target.platform === "telegram") {
    await sendBotText({
      api: target.bot.api,
      chatId: target.chatId,
      text: message,
      format: "raw",
    });
    return;
  }
  await target.bot.sendText(target.jid, message);
}

/**
 * Sends a reminder to every registered target. Failures on one target do
 * not block the others — reminders are notifications, not transactions.
 */
export async function sendReminder(message: string): Promise<void> {
  if (targets.length === 0) {
    logger.warn("[Reminder] No targets registered, skipping reminder");
    return;
  }

  await Promise.all(
    targets.map(async (target) => {
      try {
        await sendToTarget(target, message);
        logger.info(`[Reminder] Sent reminder to ${target.platform}`);
      } catch (error) {
        logger.error(`[Reminder] Failed to send to ${target.platform}:`, error);
      }
    }),
  );
}

/**
 * Runs an automatic memory backup and notifies every registered target.
 */
export async function runMemoryBackup(): Promise<void> {
  let backupPath: string | null = null;
  let backupError: unknown = null;

  try {
    backupPath = await backupMemory();
    logger.info(`[Reminder] Memory backup completed: ${backupPath}`);
  } catch (error) {
    backupError = error;
    logger.error("[Reminder] Memory backup failed:", error);
  }

  if (targets.length === 0) {
    return;
  }

  const message = backupPath
    ? `Memory backup completed: ${backupPath}`
    : `Memory backup failed: ${
        backupError instanceof Error ? backupError.message : String(backupError)
      }`;

  await Promise.all(
    targets.map(async (target) => {
      try {
        await sendToTarget(target, message);
      } catch (error) {
        logger.warn(`[Reminder] Failed to notify ${target.platform} of backup result:`, error);
      }
    }),
  );
}
