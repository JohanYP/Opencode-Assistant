import type { WhatsAppBot } from "../types.js";

export interface WhatsAppCommandContext {
  jid: string;
  // Everything after the command name, with the leading space trimmed.
  // Empty string if the command had no arguments.
  args: string;
  bot: WhatsAppBot;
  reply: (text: string) => Promise<void>;
}

export type WhatsAppCommandHandler = (ctx: WhatsAppCommandContext) => Promise<void>;
