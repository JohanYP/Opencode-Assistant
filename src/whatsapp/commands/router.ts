import { logger } from "../../utils/logger.js";
import { abortCommand } from "./abort.js";
import { helpCommand } from "./help.js";
import { newCommand } from "./new.js";
import { sessionsCommand } from "./sessions.js";
import { statusCommand } from "./status.js";
import type { WhatsAppCommandContext, WhatsAppCommandHandler } from "./types.js";

const COMMANDS: Record<string, WhatsAppCommandHandler> = {
  help: helpCommand,
  status: statusCommand,
  new: newCommand,
  sessions: sessionsCommand,
  abort: abortCommand,
  // Aliases users tend to type out of habit:
  start: helpCommand,
  cancel: abortCommand,
  stop: abortCommand,
};

export interface ParsedCommand {
  name: string;
  args: string;
}

// Extracts a command name and its argument tail from an incoming message.
// Returns null when the text doesn't look like a slash command at all,
// so callers can fall through to free-text prompt handling.
export function parseSlashCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const space = trimmed.indexOf(" ");
  const name = (space === -1 ? trimmed.slice(1) : trimmed.slice(1, space)).toLowerCase();
  const args = space === -1 ? "" : trimmed.slice(space + 1).trim();
  if (name.length === 0) return null;

  return { name, args };
}

export function isKnownCommand(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(COMMANDS, name);
}

export async function dispatchCommand(ctx: WhatsAppCommandContext, name: string): Promise<void> {
  const handler = COMMANDS[name];
  if (!handler) {
    await ctx.reply(`Unknown command: /${name}. Send /help for the list.`);
    return;
  }

  try {
    await handler(ctx);
  } catch (err) {
    logger.error(`[WhatsApp][cmd:${name}] handler threw`, err);
    await ctx.reply("Sorry, something went wrong handling that command.");
  }
}
