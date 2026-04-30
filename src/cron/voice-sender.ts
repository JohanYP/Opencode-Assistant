import { InputFile, type Bot, type Context } from "grammy";
import { config } from "../config.js";
import { isTtsEnabled } from "../settings/manager.js";
import { isTtsConfigured, synthesizeSpeech } from "../tts/client.js";
import { logger } from "../utils/logger.js";

const MAX_TTS_INPUT_CHARS = 4_000;

export async function sendCronVoiceNote(
  api: Bot<Context>["api"],
  chatId: number,
  text: string,
): Promise<void> {
  if (!isTtsEnabled() || !isTtsConfigured()) {
    return;
  }

  const normalized = text.trim();
  if (!normalized) {
    return;
  }

  if (normalized.length > MAX_TTS_INPUT_CHARS) {
    logger.warn(
      `[CronVoice] Skipping voice note: text length ${normalized.length} exceeds limit ${MAX_TTS_INPUT_CHARS}`,
    );
    return;
  }

  try {
    const speech = await synthesizeSpeech(normalized);
    const deliveryMode = config.tts.deliveryMode;

    if (deliveryMode === "voice") {
      try {
        await api.sendVoice(chatId, new InputFile(speech.buffer, speech.filename));
        return;
      } catch (voiceError) {
        logger.warn(
          `[CronVoice] sendVoice failed, falling back to sendAudio: ${(voiceError as Error)?.message ?? voiceError}`,
        );
      }
    }

    await api.sendAudio(chatId, new InputFile(speech.buffer, speech.filename));
  } catch (error) {
    logger.warn("[CronVoice] Failed to synthesize/send cron voice note", error);
  }
}
