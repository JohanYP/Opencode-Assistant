import type { Bot, Context } from "grammy";
import {
  listSkillsWithMeta,
  readMemoryFile,
  readSkill,
  writeMemoryFile,
  type WritableMemoryFile,
} from "../../memory/manager.js";
import { logger } from "../../utils/logger.js";

const MAX_TELEGRAM_MESSAGE = 4000;

function truncate(text: string): string {
  if (text.length <= MAX_TELEGRAM_MESSAGE) {
    return text;
  }
  return `${text.slice(0, MAX_TELEGRAM_MESSAGE)}\n\n...(truncated)`;
}

async function sendMemoryFile(
  ctx: Context,
  name: Parameters<typeof readMemoryFile>[0],
  label: string,
): Promise<void> {
  const content = await readMemoryFile(name);
  if (!content.trim()) {
    await ctx.reply(`${label} is empty.`);
    return;
  }
  await ctx.reply(`${label}\n\n${truncate(content)}`);
}

/**
 * Registers all /soul, /memory, /context, /memfiles, /listskill, /skill commands.
 */
export function registerMemoryCommands(bot: Bot<Context>): void {
  // /soul — view soul.md (read-only)
  bot.command("soul", async (ctx) => {
    try {
      await sendMemoryFile(ctx, "soul", "Soul");
    } catch (error) {
      logger.error("[MemoryCommands] /soul error:", error);
      await ctx.reply("Failed to read soul.md");
    }
  });

  // /memory [content] — view or append to memory.md
  bot.command("memory", async (ctx) => {
    try {
      const arg = ctx.match?.trim();
      if (arg) {
        await writeMemoryFile("memory", (await readMemoryFile("memory")) + `\n\n${arg}`);
        await ctx.reply("memory.md updated.");
        return;
      }
      await sendMemoryFile(ctx, "memory", "Memory");
    } catch (error) {
      logger.error("[MemoryCommands] /memory error:", error);
      await ctx.reply("Failed to access memory.md");
    }
  });

  // /context [content] — view or replace context.md
  bot.command("context", async (ctx) => {
    try {
      const arg = ctx.match?.trim();
      if (arg) {
        await writeMemoryFile("context", arg);
        await ctx.reply("context.md updated.");
        return;
      }
      await sendMemoryFile(ctx, "context", "Context");
    } catch (error) {
      logger.error("[MemoryCommands] /context error:", error);
      await ctx.reply("Failed to access context.md");
    }
  });

  // /agents_md — view agents.md
  bot.command("agents_md", async (ctx) => {
    try {
      await sendMemoryFile(ctx, "agents", "Agents");
    } catch (error) {
      logger.error("[MemoryCommands] /agents_md error:", error);
      await ctx.reply("Failed to read agents.md");
    }
  });

  // /memfiles — list all memory files with sizes
  bot.command("memfiles", async (ctx) => {
    try {
      const files: Array<{ name: WritableMemoryFile | "soul"; label: string }> = [
        { name: "soul", label: "soul.md (read-only)" },
        { name: "memory", label: "memory.md" },
        { name: "context", label: "context.md" },
        { name: "agents", label: "agents.md" },
      ];

      const lines: string[] = ["Memory Files\n"];
      for (const { name, label } of files) {
        const content = await readMemoryFile(name);
        const size = content.length;
        const preview = content.trim() ? "✓" : "empty";
        lines.push(`• ${label} — ${size} chars ${preview}`);
      }

      const skills = await listSkillsWithMeta();
      if (skills.length > 0) {
        lines.push(`\nSkills (${skills.length})`);
        for (const skill of skills) {
          const info = skill.description
            ? `${skill.name} — ${skill.description.slice(0, 60)}${skill.description.length > 60 ? "..." : ""}`
            : skill.name;
          lines.push(`• ${info}`);
        }
      } else {
        lines.push("\nNo skills found in memory/skills/");
      }

      lines.push("\nUse /listskill for details • /skill <name> to view one");
      await ctx.reply(lines.join("\n"));
    } catch (error) {
      logger.error("[MemoryCommands] /memfiles error:", error);
      await ctx.reply("Failed to list memory files");
    }
  });

  // /listskill — list skills available in memory/skills/ with OpenClaw metadata when present
  bot.command("listskill", async (ctx) => {
    try {
      const skills = await listSkillsWithMeta();
      if (skills.length === 0) {
        await ctx.reply(
          "No skills found in memory/skills/\n" +
            "Drop .md files into that folder to add skills.",
        );
        return;
      }

      const lines = [`Available Skills (${skills.length})\n`];
      for (const skill of skills) {
        const meta: string[] = [];
        if (skill.category) meta.push(skill.category);
        if (skill.version) meta.push(`v${skill.version}`);
        const metaStr = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
        lines.push(`• ${skill.name}${metaStr}`);
        if (skill.description) {
          const desc = skill.description.length > 80
            ? `${skill.description.slice(0, 80)}...`
            : skill.description;
          lines.push(`  ${desc}`);
        }
      }

      lines.push("\n/skill <name> to view a skill");
      await ctx.reply(lines.join("\n"));
    } catch (error) {
      logger.error("[MemoryCommands] /listskill error:", error);
      await ctx.reply("Failed to list skills");
    }
  });

  // /skill <name> — view a specific skill
  bot.command("skill", async (ctx) => {
    try {
      const skillName = ctx.match?.trim();
      if (!skillName) {
        await ctx.reply("Usage: /skill <name>\nExample: /skill web-search");
        return;
      }

      const content = await readSkill(skillName);
      if (!content.trim()) {
        await ctx.reply(
          `Skill "${skillName}" not found.\nUse /listskill to see available skills.`,
        );
        return;
      }

      await ctx.reply(`Skill: ${skillName}\n\n${truncate(content)}`);
    } catch (error) {
      logger.error("[MemoryCommands] /skill error:", error);
      await ctx.reply("Failed to read skill");
    }
  });
}
