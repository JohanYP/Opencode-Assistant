import {
  downloadMediaMessage,
  type WASocket,
  type WAMessage,
} from "@whiskeysockets/baileys";

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { shouldIgnoreSender } from "./auth.js";
import { openBaileysSession, type BaileysSession } from "./session.js";
import type {
  IncomingDocument,
  IncomingImage,
  IncomingMessage,
  IncomingVoice,
  MessageHandler,
  WhatsAppBot,
} from "./types.js";

function extractText(msg: WAMessage): string | null {
  const m = msg.message;
  if (!m) return null;
  return (
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption ??
    null
  );
}

function buildVoice(msg: WAMessage): IncomingVoice | null {
  const m = msg.message;
  if (!m) return null;
  // WhatsApp distinguishes voice notes (audioMessage with ptt=true) from
  // regular audio attachments. We accept both — STT doesn't care.
  const audio = m.audioMessage;
  if (!audio) return null;
  return {
    download: async () => {
      const stream = await downloadMediaMessage(msg, "buffer", {});
      return stream as Buffer;
    },
    mimeType: audio.mimetype ?? "audio/ogg; codecs=opus",
    ptt: Boolean(audio.ptt),
  };
}

function buildImage(msg: WAMessage): IncomingImage | null {
  const m = msg.message;
  if (!m?.imageMessage) return null;
  return {
    download: async () => (await downloadMediaMessage(msg, "buffer", {})) as Buffer,
    mimeType: m.imageMessage.mimetype ?? "image/jpeg",
    caption: m.imageMessage.caption ?? null,
  };
}

function buildDocument(msg: WAMessage): IncomingDocument | null {
  const m = msg.message;
  if (!m?.documentMessage) return null;
  return {
    download: async () => (await downloadMediaMessage(msg, "buffer", {})) as Buffer,
    mimeType: m.documentMessage.mimetype ?? "application/octet-stream",
    fileName: m.documentMessage.fileName ?? "file",
  };
}

function toIncoming(msg: WAMessage): IncomingMessage | null {
  const jid = msg.key.remoteJid;
  if (!jid) return null;
  return {
    jid,
    text: extractText(msg),
    voice: buildVoice(msg),
    image: buildImage(msg),
    document: buildDocument(msg),
    raw: msg,
  };
}

export function createWhatsAppBot(): WhatsAppBot {
  let session: BaileysSession | null = null;
  let connected = false;
  const handlers: MessageHandler[] = [];

  const wireSocket = (socket: WASocket): void => {
    socket.ev.on("messages.upsert", (event: { messages: WAMessage[]; type: string }) => {
      // We only care about brand-new incoming messages. "append" / "notify"
      // are the relevant types; "prepend" is history sync from the phone.
      if (event.type !== "notify" && event.type !== "append") return;

      for (const msg of event.messages) {
        if (!msg.message) continue;
        if (msg.key.fromMe) continue;
        if (shouldIgnoreSender(msg.key.remoteJid)) continue;

        const incoming = toIncoming(msg);
        if (!incoming) continue;

        // Run handlers sequentially so one slow handler doesn't get reordered
        // ahead of subsequent messages from the same user. Each handler is
        // wrapped to keep one failure from killing the whole pipeline.
        void (async () => {
          for (const handler of handlers) {
            try {
              await handler(incoming);
            } catch (err) {
              logger.error("[WhatsApp] Message handler threw", err);
            }
          }
        })();
      }
    });
  };

  const sendText = async (jid: string, text: string): Promise<void> => {
    if (!session) throw new Error("WhatsApp bot is not started");
    await session.getSocket().sendMessage(jid, { text });
  };

  const sendTyping = async (jid: string, state: "composing" | "paused"): Promise<void> => {
    if (!session) return;
    try {
      await session.getSocket().sendPresenceUpdate(state, jid);
    } catch (err) {
      // Presence updates are cosmetic; never let them break a real reply.
      logger.debug("[WhatsApp] sendPresenceUpdate failed (ignored)", err);
    }
  };

  const sendAudio = async (
    jid: string,
    audio: Buffer,
    opts: { mimeType?: string } = {},
  ): Promise<void> => {
    if (!session) throw new Error("WhatsApp bot is not started");
    await session.getSocket().sendMessage(jid, {
      audio,
      mimetype: opts.mimeType ?? "audio/mpeg",
    });
  };

  const sendVoice = async (
    jid: string,
    audio: Buffer,
    opts: { mimeType?: string } = {},
  ): Promise<void> => {
    if (!session) throw new Error("WhatsApp bot is not started");
    try {
      await session.getSocket().sendMessage(jid, {
        audio,
        mimetype: opts.mimeType ?? "audio/ogg; codecs=opus",
        ptt: true,
      });
    } catch (err) {
      // PTT requires OPUS; if the audio is in another format WhatsApp
      // may reject it. Fall back to a regular audio message so the user
      // still hears the reply.
      logger.warn("[WhatsApp] PTT send failed, falling back to plain audio", err);
      await sendAudio(jid, audio, opts);
    }
  };

  const sendImage = async (
    jid: string,
    image: Buffer,
    opts: { caption?: string; mimeType?: string } = {},
  ): Promise<void> => {
    if (!session) throw new Error("WhatsApp bot is not started");
    await session.getSocket().sendMessage(jid, {
      image,
      mimetype: opts.mimeType ?? "image/jpeg",
      caption: opts.caption,
    });
  };

  const sendDocument = async (
    jid: string,
    file: Buffer,
    opts: { fileName: string; mimeType: string },
  ): Promise<void> => {
    if (!session) throw new Error("WhatsApp bot is not started");
    await session.getSocket().sendMessage(jid, {
      document: file,
      mimetype: opts.mimeType,
      fileName: opts.fileName,
    });
  };

  return {
    start: async () => {
      if (session) return;
      session = await openBaileysSession({
        authDir: config.whatsapp.authDir,
        onOpen: (socket) => {
          wireSocket(socket);
          connected = true;
        },
      });
      await session.whenConnected;
    },
    stop: async () => {
      const s = session;
      session = null;
      connected = false;
      if (s) {
        await s.close();
      }
    },
    isConnected: () => connected,
    onMessage: (handler) => {
      handlers.push(handler);
    },
    sendText,
    sendTyping,
    sendAudio,
    sendVoice,
    sendImage,
    sendDocument,
  };
}

export type { IncomingMessage, MessageHandler, WhatsAppBot } from "./types.js";
