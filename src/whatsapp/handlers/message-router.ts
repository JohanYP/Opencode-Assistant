import type { IncomingMessage, WhatsAppBot } from "../types.js";
import { dispatchCommand, parseSlashCommand } from "../commands/router.js";
import type { WhatsAppCommandContext } from "../commands/types.js";
import { dispatchToPendingMenu, hasPendingMenu } from "../ui/pending.js";
import { handlePromptText } from "./prompt.js";
import { handleVoiceMessage } from "./voice.js";

function buildContext(msg: IncomingMessage, bot: WhatsAppBot, args: string): WhatsAppCommandContext {
  return {
    jid: msg.jid,
    args,
    bot,
    reply: (text) => bot.sendText(msg.jid, text),
  };
}

// Top-level routing for incoming WhatsApp messages, in priority order:
//   1. Slash commands always win — that's how the user breaks out of any
//      stuck state (/abort, /help) without us guessing intent.
//   2. Pending numbered menu — if the user is mid-selection, route the
//      reply to the menu's callback.
//   3. Voice notes go to STT (Phase 4 wires this in).
//   4. Free text falls through to the prompt handler.
export async function routeIncomingMessage(
  msg: IncomingMessage,
  bot: WhatsAppBot,
): Promise<void> {
  const text = msg.text ?? "";

  if (text.length > 0) {
    const command = parseSlashCommand(text);
    if (command) {
      const ctx = buildContext(msg, bot, command.args);
      await dispatchCommand(ctx, command.name);
      return;
    }
  }

  if (text.length > 0 && hasPendingMenu(msg.jid)) {
    const consumed = await dispatchToPendingMenu(msg.jid, text);
    if (consumed) return;
  }

  if (msg.voice) {
    const ctx = buildContext(msg, bot, "");
    await handleVoiceMessage(ctx, msg.voice, bot);
    return;
  }

  if (text.length === 0) {
    // Image/document/sticker without caption. Acknowledge so the user knows
    // it arrived, but otherwise ignore in V1.
    await bot.sendText(msg.jid, "Received, but I can't act on this content type yet.");
    return;
  }

  const ctx = buildContext(msg, bot, "");
  await handlePromptText(ctx, text);
}
