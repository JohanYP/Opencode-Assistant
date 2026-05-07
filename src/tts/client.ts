import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import textToSpeech from "@google-cloud/text-to-speech";
import { synthesizeWithEdge } from "./edge.js";

const TTS_REQUEST_TIMEOUT_MS = 60_000;

export interface TtsResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

export function isTtsConfigured(): boolean {
  if (config.tts.provider === "edge") {
    // Edge TTS uses the public Microsoft endpoint over WebSocket; no
    // credentials needed. Always considered "configured" so users with
    // an empty .env still get audio out of the box.
    return true;
  }
  if (config.tts.provider === "google") {
    return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  }
  if (config.tts.provider === "speechify") {
    return Boolean(config.tts.speechifyApiKey);
  }
  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

/**
 * Removes markdown syntax that TTS engines would read aloud
 * (asterisks, backticks, heading markers, etc.).
 */
export function stripMarkdownForSpeech(text: string): string {
  let clean = text;

  // fenced code blocks → inline content
  clean = clean.replace(/```[\s\S]*?```/g, (match) => {
    const inner = match.replace(/^```\w*\n?/, "").replace(/\n?```$/, "");
    return inner.replace(/\n/g, " ");
  });

  clean = clean.replace(/`([^`]+)`/g, "$1");
  clean = clean.replace(/\*\*\*(.+?)\*\*\*/g, "$1");
  clean = clean.replace(/\*\*(.+?)\*\*/g, "$1");
  clean = clean.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  clean = clean.replace(/~~(.+?)~~/g, "$1");
  clean = clean.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  clean = clean.replace(/^#{1,6}\s+/gm, "");
  clean = clean.replace(/^>\s?/gm, "");
  clean = clean.replace(/^[-*]\s+/gm, "");
  clean = clean.replace(/^\d+\.\s+/gm, "");
  clean = clean.replace(/^[-*_]{3,}\s*$/gm, "");
  clean = clean.replace(/<\/?[A-Za-z][^>]*>/g, "");
  clean = clean.replace(/[ \t]+/g, " ");
  clean = clean.replace(/\n{3,}/g, "\n\n");

  return clean.trim();
}

/** Extracts "ll-CC" from Google voice names like "de-DE-Neural2-B". */
export function extractLanguageCode(voiceName: string): string {
  const match = voiceName.match(/^([a-z]{2,3}-[A-Z]{2})/);
  return match ? match[1] : "en-US";
}

// --- Provider implementations ---

let googleClient: textToSpeech.TextToSpeechClient | null = null;

function getGoogleClient(): textToSpeech.TextToSpeechClient {
  if (!googleClient) {
    googleClient = new textToSpeech.TextToSpeechClient();
  }
  return googleClient;
}

/** @internal Reset Google client singleton (for tests only). */
export function _resetGoogleClient(): void {
  googleClient = null;
}

async function synthesizeWithGoogle(text: string): Promise<TtsResult> {
  const client = getGoogleClient();
  const voiceName = config.tts.voice || "en-US-Studio-O";
  const languageCode = extractLanguageCode(voiceName);

  logger.debug(
    `[TTS] Google Cloud TTS: voice=${voiceName}, languageCode=${languageCode}, chars=${text.length}`,
  );

  const [response] = await client.synthesizeSpeech(
    {
      input: { text },
      voice: { languageCode, name: voiceName },
      audioConfig: { audioEncoding: "MP3" },
    },
    { timeout: TTS_REQUEST_TIMEOUT_MS },
  );

  const raw = response.audioContent;
  const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
  if (buffer.length === 0) {
    throw new Error("Google TTS API returned an empty audio response");
  }

  return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
}

async function synthesizeWithOpenAi(text: string): Promise<TtsResult> {
  const url = `${config.tts.apiUrl}/audio/speech`;

  logger.debug(
    `[TTS] OpenAI-compatible: url=${url}, model=${config.tts.model}, voice=${config.tts.voice}, chars=${text.length}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.tts.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.tts.model,
        voice: config.tts.voice,
        input: text,
        response_format: "mp3",
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `TTS API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("TTS API returned an empty audio response");
    }

    logger.debug(`[TTS] Generated speech audio: ${buffer.length} bytes`);
    return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Speechify TTS — uses the official @speechify/api SDK.
 * Response comes as Base64-encoded audio in a JSON body.
 * Free tier: 50,000 characters/month.
 */
async function synthesizeWithSpeechify(text: string): Promise<TtsResult> {
  const apiKey = config.tts.speechifyApiKey;
  if (!apiKey) {
    throw new Error("TTS is not configured: set SPEECHIFY_API_KEY");
  }

  const voice = config.tts.voice || "henry";

  logger.debug(
    `[TTS] Speechify: voice=${voice}, chars=${text.length}`,
  );

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TTS_REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.speechify.ai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      // Speechify uses snake_case field names. Sending `voiceId` (camelCase)
      // makes the API reject the request with "Field voice_id is required".
      body: JSON.stringify({
        input: text,
        voice_id: voice,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(
        `Speechify API returned HTTP ${response.status}: ${errorBody || response.statusText}`,
      );
    }

    const json = (await response.json()) as { audioData?: string; audio_data?: string };
    const base64Audio = json.audioData ?? json.audio_data ?? "";

    if (!base64Audio) {
      throw new Error("Speechify API returned an empty audio response");
    }

    const buffer = Buffer.from(base64Audio, "base64");
    if (buffer.length === 0) {
      throw new Error("Speechify API returned an empty audio buffer");
    }

    logger.debug(`[TTS] Speechify generated speech audio: ${buffer.length} bytes`);
    return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
  } finally {
    clearTimeout(timeout);
  }
}

// --- TTS accumulator for session.idle mode ---
// Accumulates the last assistant message per session and synthesizes
// a single audio only when session.idle fires (TTS_WAIT_FOR_IDLE=true).

const pendingTtsTexts = new Map<string, string>();

/**
 * Stores the latest completed assistant message text for a session.
 * Called on every onComplete — only the last one matters.
 *
 * Defensive: skips empty/whitespace-only text. OpenCode sometimes emits a
 * final completion event with an empty message after a tool-call sequence;
 * without this guard, that empty string would pin the accumulator and
 * `flushTtsText` would later return "", which the idle handler treats as
 * "nothing to send" — silently dropping the audio for the whole turn.
 */
export function accumulateTtsText(sessionId: string, text: string): void {
  if (!config.tts.waitForIdle) {
    return;
  }
  if (!text || !text.trim()) {
    return;
  }
  pendingTtsTexts.set(sessionId, text);
}

/**
 * Returns the accumulated text for a session and clears it.
 * Called when session.idle fires.
 */
export function flushTtsText(sessionId: string): string | null {
  const text = pendingTtsTexts.get(sessionId) ?? null;
  pendingTtsTexts.delete(sessionId);
  return text;
}

// --- Public API ---

function getNotConfiguredMessage(): string {
  switch (config.tts.provider) {
    case "google":
      return "TTS is not configured: set GOOGLE_APPLICATION_CREDENTIALS for Google Cloud TTS";
    case "speechify":
      return "TTS is not configured: set SPEECHIFY_API_KEY";
    case "edge":
      // Should never reach here — Edge has no config requirements.
      return "Edge TTS unavailable (unexpected configuration error)";
    default:
      return "TTS is not configured: set TTS_API_URL and TTS_API_KEY";
  }
}

async function synthesizeWithEdgeProvider(text: string): Promise<TtsResult> {
  const voice = config.tts.voice || "en-US-AriaNeural";
  logger.debug(`[TTS] Edge: voice=${voice}, chars=${text.length}`);
  const buffer = await synthesizeWithEdge(text, { voice });
  if (buffer.length === 0) {
    throw new Error("Edge TTS returned an empty audio response");
  }
  return { buffer, filename: "assistant-reply.mp3", mimeType: "audio/mpeg" };
}

export async function synthesizeSpeech(text: string): Promise<TtsResult> {
  if (!isTtsConfigured()) {
    throw new Error(getNotConfiguredMessage());
  }

  const raw = text.trim();
  if (!raw) {
    throw new Error("TTS input text is empty");
  }

  const input = stripMarkdownForSpeech(raw);

  try {
    switch (config.tts.provider) {
      case "google":
        return await synthesizeWithGoogle(input);
      case "speechify":
        return await synthesizeWithSpeechify(input);
      case "edge":
        return await synthesizeWithEdgeProvider(input);
      default:
        return await synthesizeWithOpenAi(input);
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(`TTS request timed out after ${TTS_REQUEST_TIMEOUT_MS}ms`);
    }
    throw err;
  }
}


