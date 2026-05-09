import type { WhatsAppCommandHandler } from "./types.js";

const HELP_TEXT = [
  "*Opencode-Assistant — WhatsApp commands*",
  "",
  "/status — server health, current session and project",
  "/new — start a new OpenCode session",
  "/sessions — list recent sessions and switch",
  "/abort — stop the current task",
  "/help — show this help",
  "",
  "Send any other text to talk to the assistant.",
  "Voice notes are not yet supported (coming soon).",
].join("\n");

export const helpCommand: WhatsAppCommandHandler = async (ctx) => {
  await ctx.reply(HELP_TEXT);
};
