import { InputFile } from "grammy";
import { consumePromptResponseMode } from "../handlers/prompt.js";
import { isTtsConfigured, synthesizeSpeech, type TtsResult } from "../../tts/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const MAX_TTS_INPUT_CHARS = 4_000;

interface TelegramVoiceApi {
  sendVoice: (chatId: number, voice: InputFile) => Promise<unknown>;
  sendMessage: (chatId: number, text: string) => Promise<unknown>;
}

interface SendTtsResponseParams {
  api: TelegramVoiceApi;
  sessionId: string;
  chatId: number;
  text: string;
  consumeResponseMode?: (sessionId: string) => "text_only" | "text_and_tts" | null;
  isTtsConfigured?: () => boolean;
  synthesizeSpeech?: (text: string) => Promise<TtsResult>;
}

export async function sendTtsResponseForSession({
  api,
  sessionId,
  chatId,
  text,
  consumeResponseMode: consumeResponseModeImpl = consumePromptResponseMode,
  isTtsConfigured: isTtsConfiguredImpl = isTtsConfigured,
  synthesizeSpeech: synthesizeSpeechImpl = synthesizeSpeech,
}: SendTtsResponseParams): Promise<boolean> {
  const responseMode = consumeResponseModeImpl(sessionId);
  if (responseMode !== "text_and_tts") {
    return false;
  }

  const normalizedText = text.trim();
  if (!normalizedText) {
    return false;
  }

  if (!isTtsConfiguredImpl()) {
    logger.info(`[TTS] Skipping voice reply for session ${sessionId}: TTS is not configured`);
    return false;
  }

  if (normalizedText.length > MAX_TTS_INPUT_CHARS) {
    logger.warn(
      `[TTS] Skipping voice reply for session ${sessionId}: text length ${normalizedText.length} exceeds limit ${MAX_TTS_INPUT_CHARS}`,
    );
    return false;
  }

  try {
    const speech = await synthesizeSpeechImpl(normalizedText);
    // Send as voice note (circular waveform in Telegram) instead of audio file
    await api.sendVoice(chatId, new InputFile(speech.buffer, speech.filename));
    logger.info(`[TTS] Sent voice note reply for session ${sessionId}`);
    return true;
  } catch (error) {
    logger.warn(`[TTS] Failed to send voice note reply for session ${sessionId}`, error);

    await api.sendMessage(chatId, t("tts.failed")).catch((sendError) => {
      logger.warn(`[TTS] Failed to send TTS error message for session ${sessionId}`, sendError);
    });

    return false;
  }
}
