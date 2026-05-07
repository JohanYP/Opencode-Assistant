import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";
import { logger } from "../utils/logger.js";

/**
 * Microsoft Edge TTS provider — neural voices, free, no API key.
 *
 * The free Microsoft Edge TTS endpoint is reached over WebSocket using
 * the `msedge-tts` npm package. Voices are the same neural voices that
 * power Edge's "read aloud" feature: ~400 voices across ~140 locales.
 *
 * Latency is ~1-2 seconds for short responses (<200 chars). The
 * underlying service has no documented quota for personal use.
 */

export interface EdgeVoiceInfo {
  id: string;       // ShortName, e.g. "en-US-AriaNeural"
  name: string;     // FriendlyName
  locale: string;   // e.g. "en-US"
  gender: string;   // "Male" | "Female"
}

export interface EdgeSynthOptions {
  voice: string;
  /**
   * Speaking rate: a multiplier (0.5..2.0). 1.0 is normal speed.
   * Translated to Edge's "+/-N%" string before being sent.
   */
  rate?: number;
  /** Pitch shift in semitones (-12..+12). 0 is unmodified. */
  pitch?: number;
}

const DEFAULT_FORMAT = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;

function rateToPercent(rate: number | undefined): string {
  if (typeof rate !== "number" || !Number.isFinite(rate)) return "+0%";
  // 1.0 → +0%, 1.2 → +20%, 0.8 → -20%, clamped to ±50% so output
  // stays comprehensible.
  const pct = Math.max(-50, Math.min(50, Math.round((rate - 1) * 100)));
  return pct >= 0 ? `+${pct}%` : `${pct}%`;
}

function pitchToString(pitch: number | undefined): string {
  if (typeof pitch !== "number" || !Number.isFinite(pitch)) return "+0Hz";
  // Convert semitones to Hz approximation (Edge accepts Hz). 1 semitone
  // ≈ 5.9% of base frequency; for typical speech ~150 Hz, that's ~9 Hz.
  const hz = Math.max(-180, Math.min(180, Math.round(pitch * 9)));
  return hz >= 0 ? `+${hz}Hz` : `${hz}Hz`;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    if (Buffer.isBuffer(chunk)) {
      chunks.push(chunk);
    } else if (typeof chunk === "string") {
      chunks.push(Buffer.from(chunk, "utf8"));
    } else {
      chunks.push(Buffer.from(chunk as unknown as ArrayBuffer));
    }
  }
  return Buffer.concat(chunks);
}

/**
 * Synthesize `text` to MP3 using the given Edge neural voice.
 *
 * Each call opens its own WebSocket. The package handles reconnects
 * internally on transient drops.
 */
export async function synthesizeWithEdge(
  text: string,
  options: EdgeSynthOptions,
): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(options.voice, DEFAULT_FORMAT);
    const { audioStream } = tts.toStream(text, {
      rate: rateToPercent(options.rate),
      pitch: pitchToString(options.pitch),
    });
    const buffer = await streamToBuffer(audioStream);
    if (buffer.length === 0) {
      throw new Error("Edge TTS returned an empty audio buffer");
    }
    logger.debug(`[TTS/Edge] synthesized ${buffer.length} bytes (voice=${options.voice})`);
    return buffer;
  } finally {
    try {
      tts.close();
    } catch {
      // ignore
    }
  }
}

let cachedVoices: EdgeVoiceInfo[] | null = null;

/**
 * Returns the catalog of voices Microsoft Edge exposes. Cached in-process
 * after the first call. Bypass the cache only via `__resetEdgeVoiceCacheForTests`.
 */
export async function listEdgeVoices(): Promise<EdgeVoiceInfo[]> {
  if (cachedVoices) {
    return cachedVoices;
  }
  const tts = new MsEdgeTTS();
  try {
    const raw = await tts.getVoices();
    cachedVoices = raw.map((v) => ({
      id: v.ShortName,
      name: v.FriendlyName,
      locale: v.Locale,
      gender: v.Gender,
    }));
    return cachedVoices;
  } finally {
    try {
      tts.close();
    } catch {
      // ignore
    }
  }
}

/** Test-only: drop the cached voices list. */
export function __resetEdgeVoiceCacheForTests(): void {
  cachedVoices = null;
}
