import { isSttConfigured, transcribeAudio } from "../../stt/client.js";
import { logger } from "../../utils/logger.js";
import type { IncomingVoice, WhatsAppBot } from "../types.js";
import type { WhatsAppCommandContext } from "../commands/types.js";
import { handlePromptText } from "./prompt.js";

// Picks a filename extension that matches the inbound mime type. The Whisper
// API uses the extension to detect the audio format, so labelling matters.
function filenameForMime(mime: string): string {
  if (mime.includes("ogg") || mime.includes("opus")) return "audio.ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "audio.mp3";
  if (mime.includes("wav")) return "audio.wav";
  if (mime.includes("m4a") || mime.includes("mp4") || mime.includes("aac")) return "audio.m4a";
  if (mime.includes("webm")) return "audio.webm";
  return "audio.ogg";
}

export async function handleVoiceMessage(
  ctx: WhatsAppCommandContext,
  voice: IncomingVoice,
  bot: WhatsAppBot,
): Promise<void> {
  if (!isSttConfigured()) {
    await ctx.reply(
      "Voice notes require STT to be configured (set STT_API_URL and STT_API_KEY). " +
        "Send text for now.",
    );
    return;
  }

  // Native typing indicator while we download + transcribe + run the prompt.
  // This replaces what would otherwise be two extra messages (transcription
  // echo + "Working on it..."). On WhatsApp those acks can't be edited or
  // deleted, so they'd permanently clutter the chat. Presence updates
  // disappear on their own. The prompt handler also sends its own typing
  // hint when it picks up; calling twice is harmless.
  await bot.sendTyping(ctx.jid, "composing");

  let buffer: Buffer;
  try {
    buffer = await voice.download();
  } catch (err) {
    logger.error("[WhatsApp][voice] failed to download audio", err);
    await bot.sendTyping(ctx.jid, "paused");
    await ctx.reply("Could not download your voice note.");
    return;
  }

  if (buffer.length === 0) {
    await bot.sendTyping(ctx.jid, "paused");
    await ctx.reply("That voice note was empty.");
    return;
  }

  let text: string;
  try {
    const result = await transcribeAudio(buffer, filenameForMime(voice.mimeType));
    text = result.text.trim();
  } catch (err) {
    logger.error("[WhatsApp][voice] transcription failed", err);
    await bot.sendTyping(ctx.jid, "paused");
    await ctx.reply("Could not transcribe that voice note.");
    return;
  }

  if (!text) {
    await bot.sendTyping(ctx.jid, "paused");
    await ctx.reply("Couldn't make out any speech in that voice note.");
    return;
  }

  // Note: we deliberately do NOT echo "🎙 transcribed text" the way Telegram
  // does. Telegram edits the previous status message in-place; on WhatsApp
  // every reply is permanent, so the echo would just be noise. The user
  // already has their voice note in chat history if they want to verify.
  // The prompt handler will handle pause/resume of the typing indicator.
  await handlePromptText(ctx, text);
}
