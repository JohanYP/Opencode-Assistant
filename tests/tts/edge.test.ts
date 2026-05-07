import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock is hoisted above any `const ... = vi.fn()`, so the mocks
// themselves must be created via vi.hoisted() to exist at mock-eval time.
const { setMetadataMock, closeMock, toStreamMock, getVoicesMock } = vi.hoisted(() => ({
  setMetadataMock: vi.fn(async () => undefined),
  closeMock: vi.fn(() => undefined),
  toStreamMock: vi.fn(),
  getVoicesMock: vi.fn(),
}));

vi.mock("msedge-tts", () => {
  class MsEdgeTTSMock {
    setMetadata = setMetadataMock;
    toStream = toStreamMock;
    getVoices = getVoicesMock;
    close = closeMock;
  }
  return {
    MsEdgeTTS: MsEdgeTTSMock,
    OUTPUT_FORMAT: { AUDIO_24KHZ_48KBITRATE_MONO_MP3: "audio-24khz-48kbitrate-mono-mp3" },
  };
});

import {
  __resetEdgeVoiceCacheForTests,
  listEdgeVoices,
  synthesizeWithEdge,
} from "../../src/tts/edge.js";

function streamFrom(chunks: Buffer[]): Readable {
  return Readable.from(chunks);
}

describe("tts/edge", () => {
  beforeEach(() => {
    setMetadataMock.mockClear();
    closeMock.mockClear();
    toStreamMock.mockReset();
    getVoicesMock.mockReset();
    __resetEdgeVoiceCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("synthesizeWithEdge", () => {
    it("sets voice metadata and returns the streamed buffer", async () => {
      toStreamMock.mockReturnValue({
        audioStream: streamFrom([Buffer.from("hello "), Buffer.from("audio")]),
      });

      const buffer = await synthesizeWithEdge("hi", { voice: "en-US-AriaNeural" });

      expect(setMetadataMock).toHaveBeenCalledWith(
        "en-US-AriaNeural",
        "audio-24khz-48kbitrate-mono-mp3",
      );
      expect(toStreamMock).toHaveBeenCalledTimes(1);
      const args = toStreamMock.mock.calls[0];
      expect(args[0]).toBe("hi");
      expect(args[1]).toMatchObject({ rate: "+0%", pitch: "+0Hz" });
      expect(buffer.toString()).toBe("hello audio");
      expect(closeMock).toHaveBeenCalled();
    });

    it("translates rate multiplier to a percent string", async () => {
      toStreamMock.mockReturnValue({
        audioStream: streamFrom([Buffer.from("x")]),
      });
      await synthesizeWithEdge("x", { voice: "v", rate: 1.2 });
      expect(toStreamMock.mock.calls[0][1]).toMatchObject({ rate: "+20%" });

      toStreamMock.mockClear();
      toStreamMock.mockReturnValue({ audioStream: streamFrom([Buffer.from("x")]) });
      await synthesizeWithEdge("x", { voice: "v", rate: 0.8 });
      expect(toStreamMock.mock.calls[0][1]).toMatchObject({ rate: "-20%" });
    });

    it("clamps extreme rates to ±50%", async () => {
      toStreamMock.mockReturnValue({ audioStream: streamFrom([Buffer.from("x")]) });
      await synthesizeWithEdge("x", { voice: "v", rate: 5 });
      expect(toStreamMock.mock.calls[0][1]).toMatchObject({ rate: "+50%" });
    });

    it("throws on empty audio buffer", async () => {
      toStreamMock.mockReturnValue({ audioStream: streamFrom([]) });
      await expect(synthesizeWithEdge("x", { voice: "v" })).rejects.toThrow(/empty audio/);
    });

    it("closes the WebSocket even when streaming throws", async () => {
      toStreamMock.mockImplementation(() => {
        throw new Error("nope");
      });
      await expect(synthesizeWithEdge("x", { voice: "v" })).rejects.toThrow("nope");
      expect(closeMock).toHaveBeenCalled();
    });
  });

  describe("listEdgeVoices", () => {
    it("returns the catalog mapped to {id,name,locale,gender}", async () => {
      getVoicesMock.mockResolvedValue([
        {
          ShortName: "en-US-AriaNeural",
          FriendlyName: "Aria (English, US)",
          Locale: "en-US",
          Gender: "Female",
        },
        {
          ShortName: "es-ES-ElviraNeural",
          FriendlyName: "Elvira (Spanish, Spain)",
          Locale: "es-ES",
          Gender: "Female",
        },
      ]);

      const out = await listEdgeVoices();
      expect(out).toEqual([
        {
          id: "en-US-AriaNeural",
          name: "Aria (English, US)",
          locale: "en-US",
          gender: "Female",
        },
        {
          id: "es-ES-ElviraNeural",
          name: "Elvira (Spanish, Spain)",
          locale: "es-ES",
          gender: "Female",
        },
      ]);
    });

    it("caches the result so getVoices is called only once", async () => {
      getVoicesMock.mockResolvedValue([
        { ShortName: "v", FriendlyName: "V", Locale: "en-US", Gender: "Female" },
      ]);

      await listEdgeVoices();
      await listEdgeVoices();
      await listEdgeVoices();
      expect(getVoicesMock).toHaveBeenCalledTimes(1);
    });

    it("re-fetches after __resetEdgeVoiceCacheForTests", async () => {
      getVoicesMock.mockResolvedValue([
        { ShortName: "v", FriendlyName: "V", Locale: "en-US", Gender: "Female" },
      ]);
      await listEdgeVoices();
      __resetEdgeVoiceCacheForTests();
      await listEdgeVoices();
      expect(getVoicesMock).toHaveBeenCalledTimes(2);
    });
  });
});
