import { InputFile } from "grammy";
import { config } from "../../config.js";
import { consumePromptResponseMode } from "../handlers/prompt.js";
import {
  convertMp3ToOggOpus,
  isTtsConfigured,
  synthesizeSpeech,
  type TtsResult,
} from "../../tts/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const MAX_TTS_INPUT_CHARS = 4_000;

interface TelegramTtsApi {
  // sendVoice: used for "voice" delivery mode after MP3→OGG/Opus conversion.
  // Telegram's sendVoice STRICTLY requires OGG/Opus and rejects anything
  // else with HTTP 400. We provide sendAudio as a graceful fallback.
  sendVoice: (chatId: number, voice: InputFile) => Promise<unknown>;
  // sendAudio: used for "audio" delivery mode and as the fallback when
  // OGG/Opus conversion fails (e.g. ffmpeg not installed).
  sendAudio: (chatId: number, audio: InputFile) => Promise<unknown>;
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
}

interface SendTtsResponseParams {
  api: TelegramTtsApi;
  sessionId: string;
  chatId: number;
  text: string;
  consumeResponseMode?: (sessionId: string) => "text_only" | "text_and_tts" | null;
  isTtsConfigured?: () => boolean;
  synthesizeSpeech?: (text: string) => Promise<TtsResult>;
  // Injected for tests; defaults to the real ffmpeg-based converter.
  convertToOggOpus?: (mp3: Buffer) => Promise<Buffer>;
  // Injected for tests; defaults to config.tts.deliveryMode.
  deliveryMode?: "voice" | "audio";
}

async function sendAsAudio(
  api: TelegramTtsApi,
  chatId: number,
  speech: TtsResult,
  sessionId: string,
): Promise<void> {
  await api.sendAudio(chatId, new InputFile(speech.buffer, speech.filename));
  logger.info(`[TTS] Sent audio reply for session ${sessionId}`);
}

export async function sendTtsResponseForSession({
  api,
  sessionId,
  chatId,
  text,
  consumeResponseMode: consumeResponseModeImpl = consumePromptResponseMode,
  isTtsConfigured: isTtsConfiguredImpl = isTtsConfigured,
  synthesizeSpeech: synthesizeSpeechImpl = synthesizeSpeech,
  convertToOggOpus: convertToOggOpusImpl = convertMp3ToOggOpus,
  deliveryMode: deliveryModeOverride,
}: SendTtsResponseParams): Promise<boolean> {
  const responseMode = consumeResponseModeImpl(sessionId);
  if (responseMode !== "text_and_tts") {
    logger.debug(
      `[TTS] Skipping audio reply for session ${sessionId}: responseMode=${responseMode ?? "null"}`,
    );
    return false;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    logger.debug(`[TTS] Skipping audio reply for session ${sessionId}: text is empty after trim`);
    return false;
  }

  if (!isTtsConfiguredImpl()) {
    logger.info(`[TTS] Skipping audio reply for session ${sessionId}: TTS is not configured`);
    return false;
  }

  if (normalizedText.length > MAX_TTS_INPUT_CHARS) {
    logger.warn(
      `[TTS] Skipping audio reply for session ${sessionId}: text length ${normalizedText.length} exceeds limit ${MAX_TTS_INPUT_CHARS}`,
    );
    return false;
  }

  const deliveryMode = deliveryModeOverride ?? config.tts.deliveryMode;

  try {
    const speech = await synthesizeSpeechImpl(normalizedText);

    if (deliveryMode === "voice") {
      try {
        const ogg = await convertToOggOpusImpl(speech.buffer);
        await api.sendVoice(chatId, new InputFile(ogg, "assistant-reply.ogg"));
        logger.info(`[TTS] Sent voice note reply for session ${sessionId}`);
        return true;
      } catch (conversionError) {
        // Fallback to sendAudio so the user still gets audio. The most
        // common reason here is ffmpeg missing from PATH (ENOENT).
        logger.warn(
          `[TTS] OGG/Opus conversion or sendVoice failed for session ${sessionId}, falling back to sendAudio: ${(conversionError as Error)?.message ?? conversionError}`,
        );
        await sendAsAudio(api, chatId, speech, sessionId);
        return true;
      }
    }

    await sendAsAudio(api, chatId, speech, sessionId);
    return true;
  } catch (error) {
    logger.warn(`[TTS] Failed to send audio reply for session ${sessionId}`, error);

    await api.sendMessage(chatId, t("tts.failed")).catch((sendError) => {
      logger.warn(`[TTS] Failed to send TTS error message for session ${sessionId}`, sendError);
    });

    return false;
  }
}
