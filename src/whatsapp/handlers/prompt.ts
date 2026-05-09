import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject, isTtsEnabled } from "../../settings/manager.js";
import { injectMemoryIntoPrompt } from "../../memory/injector.js";
import { isTtsConfigured, synthesizeSpeech } from "../../tts/client.js";
import { logger } from "../../utils/logger.js";
import { collectResponseText, type ResponsePart } from "../utils/response-text.js";
import { chunkForWhatsApp } from "../utils/chunking.js";
import { mp3ToOpusOgg } from "../utils/audio-convert.js";
import type { WhatsAppCommandContext } from "../commands/types.js";

// Tracks whether a session is currently being prompted from WhatsApp so a
// second message from the same user doesn't fire a parallel prompt against
// the same session (OpenCode rejects concurrent prompts on a busy session).
const inFlightBySession = new Set<string>();

interface PromptResponse {
  parts?: ResponsePart[];
}

export async function handlePromptText(
  ctx: WhatsAppCommandContext,
  text: string,
): Promise<void> {
  const project = getCurrentProject();
  if (!project) {
    await ctx.reply(
      "No project selected. Open Telegram and pick one with /projects first.",
    );
    return;
  }

  const session = getCurrentSession("whatsapp");
  if (!session) {
    await ctx.reply("No active session. Send /new to start one.");
    return;
  }

  if (inFlightBySession.has(session.id)) {
    await ctx.reply("⏳ The previous task is still running. Send /abort to stop it.");
    return;
  }

  // Native WhatsApp "typing..." indicator instead of an ack message.
  // WhatsApp can't edit or delete our messages the way Telegram can, so any
  // status text we'd send ("Working on it...") would clutter the chat
  // permanently. Presence updates show in the chat header and disappear on
  // their own once we stop refreshing them, keeping the conversation clean.
  await ctx.bot.sendTyping(ctx.jid, "composing");

  inFlightBySession.add(session.id);

  try {
    const enrichedText = await injectMemoryIntoPrompt(text, session.id, { channel: "whatsapp" });

    const result = await opencodeClient.session.prompt({
      sessionID: session.id,
      directory: session.directory,
      parts: [{ type: "text", text: enrichedText }],
    });

    if (result.error) {
      logger.error("[WhatsApp][prompt] OpenCode error", result.error);
      await ctx.reply(
        "OpenCode returned an error. Check the bot logs or try again in a moment.",
      );
      return;
    }

    const response = result.data as PromptResponse | undefined;
    const responseText = collectResponseText(response?.parts ?? null);

    if (!responseText) {
      await ctx.reply("(Empty response from the model.)");
      return;
    }

    const chunks = chunkForWhatsApp(responseText);
    for (const chunk of chunks) {
      await ctx.reply(chunk);
    }

    if (isTtsEnabled() && isTtsConfigured()) {
      // Best-effort: TTS failures shouldn't make the user lose the text reply
      // they already received. Log and move on.
      try {
        const audio = await synthesizeSpeech(responseText);
        // Try to deliver as a real WhatsApp voice note (push-to-talk with
        // waveform) — that requires OGG/Opus, which TTS providers don't
        // emit directly. Transcode via ffmpeg. If anything in the
        // pipeline fails (no ffmpeg in container, weird MP3 from the
        // provider, etc.) fall back to a plain music-player audio so the
        // user still hears the reply.
        try {
          const opusBytes = await mp3ToOpusOgg(audio.buffer);
          await ctx.bot.sendVoice(ctx.jid, opusBytes, {
            mimeType: "audio/ogg; codecs=opus",
          });
        } catch (transcodeErr) {
          logger.warn(
            "[WhatsApp][prompt] OPUS transcode failed, sending MP3 as audio attachment",
            transcodeErr,
          );
          await ctx.bot.sendAudio(ctx.jid, audio.buffer, { mimeType: audio.mimeType });
        }
      } catch (ttsErr) {
        logger.warn("[WhatsApp][prompt] TTS failed, text reply still delivered", ttsErr);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      await ctx.reply("Request was aborted.");
      return;
    }
    logger.error("[WhatsApp][prompt] unexpected error", err);
    await ctx.reply("Something went wrong while talking to the model. Try again.");
  } finally {
    inFlightBySession.delete(session.id);
    // Clear the typing hint regardless of outcome.
    await ctx.bot.sendTyping(ctx.jid, "paused");
  }
}
