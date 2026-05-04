import type { I18nKey } from "../../i18n/en.js";
import { t } from "../../i18n/index.js";

/**
 * Centralized bot commands definitions
 * Used for both Telegram API setMyCommands and command handler registration
 */

export interface BotCommandDefinition {
  command: string;
  description: string;
}

interface BotCommandI18nDefinition {
  command: string;
  descriptionKey: I18nKey;
}

/**
 * List of all bot commands
 * Update this array when adding new commands
 */
const COMMAND_DEFINITIONS: BotCommandI18nDefinition[] = [
  { command: "status", descriptionKey: "cmd.description.status" },
  { command: "new", descriptionKey: "cmd.description.new" },
  { command: "abort", descriptionKey: "cmd.description.stop" },
  { command: "sessions", descriptionKey: "cmd.description.sessions" },
  { command: "tts", descriptionKey: "cmd.description.tts" },
  { command: "projects", descriptionKey: "cmd.description.projects" },
  { command: "worktree", descriptionKey: "cmd.description.worktree" },
  { command: "task", descriptionKey: "cmd.description.task" },
  { command: "tasklist", descriptionKey: "cmd.description.tasklist" },
  { command: "rename", descriptionKey: "cmd.description.rename" },
  { command: "commands", descriptionKey: "cmd.description.commands" },
  { command: "mcplist", descriptionKey: "cmd.description.mcplist" },
  { command: "opencode_start", descriptionKey: "cmd.description.opencode_start" },
  { command: "opencode_stop", descriptionKey: "cmd.description.opencode_stop" },
  { command: "open", descriptionKey: "cmd.description.open" },
  { command: "soul", descriptionKey: "cmd.description.soul" },
  { command: "personality", descriptionKey: "cmd.description.personality" },
  { command: "memory", descriptionKey: "cmd.description.memory" },
  { command: "memory_search", descriptionKey: "cmd.description.memory_search" },
  { command: "context", descriptionKey: "cmd.description.context" },
  { command: "memfiles", descriptionKey: "cmd.description.memfiles" },
  { command: "show_tools", descriptionKey: "cmd.description.show_tools" },
  { command: "listskill", descriptionKey: "cmd.description.listskill" },
  { command: "skill", descriptionKey: "cmd.description.skill" },
  { command: "skill_install", descriptionKey: "cmd.description.skill_install" },
  { command: "skill_update", descriptionKey: "cmd.description.skill_update" },
  { command: "skill_verify", descriptionKey: "cmd.description.skill_verify" },
  { command: "skill_remove", descriptionKey: "cmd.description.skill_remove" },
  { command: "help", descriptionKey: "cmd.description.help" },
];

export function getLocalizedBotCommands(): BotCommandDefinition[] {
  return COMMAND_DEFINITIONS.map(({ command, descriptionKey }) => ({
    command,
    description: t(descriptionKey),
  }));
}

export const BOT_COMMANDS: BotCommandDefinition[] = getLocalizedBotCommands();
