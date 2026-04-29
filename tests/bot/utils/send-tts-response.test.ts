import { describe, expect, it, vi } from "vitest";
import { InputFile } from "grammy";
import { sendTtsResponseForSession } from "../../../src/bot/utils/send-tts-response.js";
import { t } from "../../../src/i18n/index.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Tests inject deliveryMode explicitly, so behavior under test is
// deterministic regardless of the real config.

describe("bot/utils/send-tts-response", () => {
  describe("voice delivery mode", () => {
    it("sends the synthesized MP3 directly via sendVoice", async () => {
      const sendVoiceMock = vi.fn().mockResolvedValue(undefined);
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3-bytes"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello voice note",
        consumeResponseMode: () => "text_and_tts",
        isTtsConfigured: () => true,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(true);
      expect(synthesizeSpeechMock).toHaveBeenCalledWith("Hello voice note");
      expect(sendVoiceMock).toHaveBeenCalledTimes(1);
      const [chatId, inputFile] = sendVoiceMock.mock.calls[0];
      expect(chatId).toBe(123);
      expect(inputFile).toBeInstanceOf(InputFile);
      // Telegram transcodes the MP3 server-side (OpenClaw approach); the
      // bot must NOT have used sendAudio or sent an error message.
      expect(sendAudioMock).not.toHaveBeenCalled();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    // Regression guard: in rare regions/conditions Telegram may reject MP3
    // payloads at sendVoice. The user must still get audio — just as an
    // audio file via sendAudio instead of as a voice note.
    it("falls back to sendAudio when sendVoice rejects", async () => {
      const sendVoiceMock = vi.fn().mockRejectedValue(new Error("HTTP 400 from Telegram"));
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello",
        consumeResponseMode: () => "text_and_tts",
        isTtsConfigured: () => true,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(true);
      expect(sendVoiceMock).toHaveBeenCalledOnce();
      expect(sendAudioMock).toHaveBeenCalledOnce();
      const [chatId, inputFile] = sendAudioMock.mock.calls[0];
      expect(chatId).toBe(123);
      expect(inputFile).toBeInstanceOf(InputFile);
      // The user must NOT see an error in chat — fallback is graceful.
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("audio delivery mode", () => {
    it("sends MP3 directly via sendAudio", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello audio",
        consumeResponseMode: () => "text_and_tts",
        isTtsConfigured: () => true,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "audio",
      });

      expect(result).toBe(true);
      expect(synthesizeSpeechMock).toHaveBeenCalledWith("Hello audio");
      expect(sendVoiceMock).not.toHaveBeenCalled();
      expect(sendAudioMock).toHaveBeenCalledTimes(1);
      const [chatId, inputFile] = sendAudioMock.mock.calls[0];
      expect(chatId).toBe(123);
      expect(inputFile).toBeInstanceOf(InputFile);
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("skip / failure paths", () => {
    it("skips when the session response mode is text only", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn();
      const sendMessageMock = vi.fn();
      const synthesizeSpeechMock = vi.fn();

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello",
        consumeResponseMode: () => "text_only",
        isTtsConfigured: () => true,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(false);
      expect(synthesizeSpeechMock).not.toHaveBeenCalled();
      expect(sendVoiceMock).not.toHaveBeenCalled();
      expect(sendAudioMock).not.toHaveBeenCalled();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("skips when TTS is not configured", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn();
      const sendMessageMock = vi.fn();
      const synthesizeSpeechMock = vi.fn();

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello",
        consumeResponseMode: () => "text_and_tts",
        isTtsConfigured: () => false,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(false);
      expect(synthesizeSpeechMock).not.toHaveBeenCalled();
      expect(sendVoiceMock).not.toHaveBeenCalled();
      expect(sendAudioMock).not.toHaveBeenCalled();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("sends a user-facing error when synthesis fails", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn();
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockRejectedValue(new Error("provider 500"));

      const result = await sendTtsResponseForSession({
        api: {
          sendVoice: sendVoiceMock,
          sendAudio: sendAudioMock,
          sendMessage: sendMessageMock,
        },
        sessionId: "session-1",
        chatId: 123,
        text: "Hello",
        consumeResponseMode: () => "text_and_tts",
        isTtsConfigured: () => true,
        synthesizeSpeech: synthesizeSpeechMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(false);
      expect(sendMessageMock).toHaveBeenCalledWith(123, t("tts.failed"));
    });
  });
});
