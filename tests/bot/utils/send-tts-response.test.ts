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

// We don't import the real config here — every test injects its own
// deliveryMode so behavior under test is deterministic.

describe("bot/utils/send-tts-response", () => {
  describe("voice delivery mode", () => {
    it("converts MP3 to OGG/Opus and sends as voice note", async () => {
      const sendVoiceMock = vi.fn().mockResolvedValue(undefined);
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3-bytes"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });
      const convertMock = vi.fn().mockResolvedValue(Buffer.from("ogg-opus-bytes"));

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
        convertToOggOpus: convertMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(true);
      expect(synthesizeSpeechMock).toHaveBeenCalledWith("Hello voice note");
      expect(convertMock).toHaveBeenCalledOnce();
      expect(convertMock.mock.calls[0][0]).toEqual(Buffer.from("mp3-bytes"));
      expect(sendVoiceMock).toHaveBeenCalledTimes(1);
      const [chatId, inputFile] = sendVoiceMock.mock.calls[0];
      expect(chatId).toBe(123);
      expect(inputFile).toBeInstanceOf(InputFile);
      // The fallback path must NOT have been used.
      expect(sendAudioMock).not.toHaveBeenCalled();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    // Regression guard: ffmpeg may be missing in the runtime environment
    // (e.g. older Docker image, dev machine without ffmpeg). The user
    // should still get audio — just as an MP3 audio file instead of a
    // voice note.
    it("falls back to sendAudio when conversion fails", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3-bytes"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });
      const convertMock = vi
        .fn()
        .mockRejectedValue(Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }));

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
        convertToOggOpus: convertMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(true);
      expect(convertMock).toHaveBeenCalledOnce();
      expect(sendVoiceMock).not.toHaveBeenCalled();
      expect(sendAudioMock).toHaveBeenCalledTimes(1);
      const [chatId, inputFile] = sendAudioMock.mock.calls[0];
      expect(chatId).toBe(123);
      expect(inputFile).toBeInstanceOf(InputFile);
      // The user must NOT see an error in chat — fallback is graceful.
      expect(sendMessageMock).not.toHaveBeenCalled();
    });

    it("falls back to sendAudio when sendVoice itself rejects", async () => {
      const sendVoiceMock = vi.fn().mockRejectedValue(new Error("HTTP 400 from Telegram"));
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });
      const convertMock = vi.fn().mockResolvedValue(Buffer.from("ogg"));

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
        convertToOggOpus: convertMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(true);
      expect(sendVoiceMock).toHaveBeenCalledOnce();
      expect(sendAudioMock).toHaveBeenCalledOnce();
      expect(sendMessageMock).not.toHaveBeenCalled();
    });
  });

  describe("audio delivery mode", () => {
    it("sends MP3 directly via sendAudio (no conversion)", async () => {
      const sendVoiceMock = vi.fn();
      const sendAudioMock = vi.fn().mockResolvedValue(undefined);
      const sendMessageMock = vi.fn().mockResolvedValue(undefined);
      const synthesizeSpeechMock = vi.fn().mockResolvedValue({
        buffer: Buffer.from("mp3"),
        filename: "assistant-reply.mp3",
        mimeType: "audio/mpeg",
      });
      const convertMock = vi.fn();

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
        convertToOggOpus: convertMock,
        deliveryMode: "audio",
      });

      expect(result).toBe(true);
      expect(synthesizeSpeechMock).toHaveBeenCalledWith("Hello audio");
      expect(convertMock).not.toHaveBeenCalled();
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
      const convertMock = vi.fn();

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
        convertToOggOpus: convertMock,
        deliveryMode: "voice",
      });

      expect(result).toBe(false);
      expect(synthesizeSpeechMock).not.toHaveBeenCalled();
      expect(convertMock).not.toHaveBeenCalled();
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
