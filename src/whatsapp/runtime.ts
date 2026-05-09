import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { createWhatsAppBot } from "./index.js";
import { routeIncomingMessage } from "./handlers/message-router.js";
import type { WhatsAppBot } from "./types.js";

let started: WhatsAppBot | null = null;

// Top-level lifecycle for the WhatsApp side. Returns null when the channel
// is disabled in config so callers can short-circuit without branching on
// every site that touches the bot.
export async function startWhatsApp(): Promise<WhatsAppBot | null> {
  if (!config.whatsapp.enabled) {
    logger.info("[WhatsApp] Disabled (set WHATSAPP_ENABLED=true to enable).");
    return null;
  }

  if (!config.whatsapp.allowedNumber) {
    logger.error(
      "[WhatsApp] WHATSAPP_ENABLED=true but WHATSAPP_ALLOWED_NUMBER is empty. " +
        "Set the allowed phone number (e.g. 34666999999) in .env. Skipping WhatsApp startup.",
    );
    return null;
  }

  if (started) {
    logger.warn("[WhatsApp] Already started; ignoring second startWhatsApp() call.");
    return started;
  }

  const bot = createWhatsAppBot();
  bot.onMessage((msg) => routeIncomingMessage(msg, bot));

  try {
    await bot.start();
    started = bot;
    logger.info("[WhatsApp] Bot started.");
    return bot;
  } catch (err) {
    logger.error("[WhatsApp] Failed to start bot", err);
    return null;
  }
}

export async function stopWhatsApp(): Promise<void> {
  const bot = started;
  started = null;
  if (!bot) return;
  try {
    await bot.stop();
    logger.info("[WhatsApp] Bot stopped.");
  } catch (err) {
    logger.warn("[WhatsApp] Error during stop", err);
  }
}

export function getWhatsAppBot(): WhatsAppBot | null {
  return started;
}
