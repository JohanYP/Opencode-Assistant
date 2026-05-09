import { isSttConfigured, transcribeAudio } from "../../stt/client.js";
import { config } from "../../config.js";
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

  let buffer: Buffer;
  try {
    buffer = await voice.download();
  } catch (err) {
    logger.error("[WhatsApp][voice] failed to download audio", err);
    await ctx.reply("Could not download your voice note.");
    return;
  }

  if (buffer.length === 0) {
    await ctx.reply("That voice note was empty.");
    return;
  }

  let text: string;
  try {
    const result = await transcribeAudio(buffer, filenameForMime(voice.mimeType));
    text = result.text.trim();
  } catch (err) {
    logger.error("[WhatsApp][voice] transcription failed", err);
    await ctx.reply("Could not transcribe that voice note.");
    return;
  }

  if (!text) {
    await ctx.reply("Couldn't make out any speech in that voice note.");
    return;
  }

  // Show the transcribed text unless the user explicitly hid it via the
  // shared STT_HIDE_RECOGNIZED_TEXT setting (matches Telegram behavior).
  if (!config.stt.hideRecognizedText) {
    await ctx.reply(`🎙 _${text}_`);
  }

  void bot;
  await handlePromptText(ctx, text);
}
