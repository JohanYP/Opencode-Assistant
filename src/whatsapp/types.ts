import type { WAMessage } from "@whiskeysockets/baileys";

export interface IncomingVoice {
  download: () => Promise<Buffer>;
  mimeType: string;
  // True for push-to-talk voice notes; false for music-player audio messages.
  ptt: boolean;
}

export interface IncomingImage {
  download: () => Promise<Buffer>;
  mimeType: string;
  caption: string | null;
}

export interface IncomingDocument {
  download: () => Promise<Buffer>;
  mimeType: string;
  fileName: string;
}

export interface IncomingMessage {
  jid: string;
  // Plain text body (or caption of an image). null when the message has no
  // text content (e.g. a voice-only message).
  text: string | null;
  voice: IncomingVoice | null;
  image: IncomingImage | null;
  document: IncomingDocument | null;
  // The raw Baileys message, for handlers that need access to fields not
  // covered by the high-level wrapper.
  raw: WAMessage;
}

export type MessageHandler = (msg: IncomingMessage) => Promise<void>;

export interface WhatsAppBot {
  start(): Promise<void>;
  stop(): Promise<void>;
  isConnected(): boolean;
  onMessage(handler: MessageHandler): void;
  sendText(jid: string, text: string): Promise<void>;
  // Send audio as a music-player message (any mime type, no transcoding).
  // Use this for MP3 output from TTS engines.
  sendAudio(jid: string, audio: Buffer, opts?: { mimeType?: string }): Promise<void>;
  // Send audio as a push-to-talk voice note (waveform UI). Caller MUST
  // pass OPUS-encoded bytes — WhatsApp won't transcode for us. Falls back
  // to sendAudio if delivery fails.
  sendVoice(jid: string, audio: Buffer, opts?: { mimeType?: string }): Promise<void>;
  sendImage(jid: string, image: Buffer, opts?: { caption?: string; mimeType?: string }): Promise<void>;
  sendDocument(
    jid: string,
    file: Buffer,
    opts: { fileName: string; mimeType: string },
  ): Promise<void>;
}
