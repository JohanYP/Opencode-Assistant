// Transcode TTS audio (typically MP3 from OpenAI / Speechify / Google /
// Edge) into OGG/Opus mono so Baileys can deliver it as a WhatsApp voice
// note (push-to-talk message with waveform UI). Without this conversion
// WhatsApp accepts the file but renders it as a music-player audio bubble,
// which loses the voice-note feel Telegram users get out of the box.
//
// Strategy: pipe the source bytes through ffmpeg via stdin and read the
// re-encoded bytes from stdout — no tmp files. Failures throw so the
// caller can fall back to the original MP3 via sendAudio.

import { spawn } from "node:child_process";
import { logger } from "../../utils/logger.js";

const FFMPEG_TIMEOUT_MS = 30_000;

export interface OpusConversionOptions {
  // Bitrate hint for libopus. WhatsApp voice notes use ~24-32 kbps in
  // practice; higher rates inflate the file without audible benefit at
  // mono speech frequencies.
  bitrateKbps?: number;
}

export async function mp3ToOpusOgg(
  mp3: Buffer,
  options: OpusConversionOptions = {},
): Promise<Buffer> {
  if (mp3.length === 0) {
    throw new Error("Cannot transcode empty audio buffer");
  }

  const bitrateKbps = options.bitrateKbps ?? 32;

  return await new Promise<Buffer>((resolve, reject) => {
    const ffmpeg = spawn(
      "ffmpeg",
      [
        "-hide_banner",
        "-loglevel",
        "error",
        // -i pipe:0 reads from stdin (the MP3 bytes we feed below).
        "-i",
        "pipe:0",
        // Drop video tracks if any (TTS output is audio-only, but defensive).
        "-vn",
        // Mono — voice notes are not stereo.
        "-ac",
        "1",
        // Standard sample rate that Opus handles best for speech.
        "-ar",
        "48000",
        "-c:a",
        "libopus",
        "-b:a",
        `${bitrateKbps}k`,
        "-application",
        "voip",
        // Output OGG container with the Opus stream — what Baileys expects
        // for an audioMessage with ptt: true.
        "-f",
        "ogg",
        "pipe:1",
      ],
      { stdio: ["pipe", "pipe", "pipe"] },
    );

    const chunks: Buffer[] = [];
    let stderrBuf = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        ffmpeg.kill("SIGKILL");
      } catch {
        /* ignore */
      }
      reject(new Error(`ffmpeg transcode timed out after ${FFMPEG_TIMEOUT_MS}ms`));
    }, FFMPEG_TIMEOUT_MS);

    ffmpeg.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });

    ffmpeg.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });

    ffmpeg.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    ffmpeg.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        const tail = stderrBuf.trim().split("\n").slice(-3).join(" | ");
        reject(new Error(`ffmpeg exited with code ${code}${tail ? `: ${tail}` : ""}`));
        return;
      }
      const out = Buffer.concat(chunks);
      if (out.length === 0) {
        reject(new Error("ffmpeg produced empty output"));
        return;
      }
      logger.debug(
        `[WhatsApp][audio] Transcoded ${mp3.length}B MP3 -> ${out.length}B OGG/Opus @${bitrateKbps}k`,
      );
      resolve(out);
    });

    // Feed the MP3 bytes and close stdin so ffmpeg knows the input ended.
    ffmpeg.stdin.on("error", (err) => {
      // EPIPE happens if ffmpeg exits before we finish writing — handled
      // by the `close` event already, just don't crash the process.
      logger.debug("[WhatsApp][audio] ffmpeg stdin error (likely benign)", err);
    });
    ffmpeg.stdin.end(mp3);
  });
}
