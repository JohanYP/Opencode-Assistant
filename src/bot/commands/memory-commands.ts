import https from "node:https";
import http from "node:http";
import type { Bot, Context } from "grammy";
import {
  listSkillsWithMeta,
  readMemoryFile,
  readSkill,
  writeMemoryFile,
  writeSkill,
  parseSkillFrontmatter,
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
  await ctx.reply(`**${label}**\n\n${truncate(content)}`, { parse_mode: "Markdown" });
}

/**
 * Downloads a raw URL and returns the content as string.
 * Supports http and https. Rejects on non-200 status.
 */
function downloadUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode ?? "unknown"}`));
        res.resume();
        return;
      }

      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      res.on("error", reject);
    });

    req.on("error", reject);
    req.setTimeout(15_000, () => {
      req.destroy(new Error("Request timeout"));
    });
  });
}

/**
 * Converts a GitHub blob URL to the raw content URL.
 * e.g. https://github.com/user/repo/blob/main/SKILL.md
 *   → https://raw.githubusercontent.com/user/repo/main/SKILL.md
 */
function toRawGitHubUrl(url: string): string {
  return url
    .replace("https://github.com/", "https://raw.githubusercontent.com/")
    .replace("/blob/", "/");
}

/**
 * Registers all /soul, /memory, /context, /memfiles,
 * /skills_list, /skill, /skill_install commands.
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

      const lines: string[] = ["**Memory Files**\n"];
      for (const { name, label } of files) {
        const content = await readMemoryFile(name);
        const size = content.length;
        const preview = content.trim() ? "✓" : "empty";
        lines.push(`• ${label} — ${size} chars ${preview}`);
      }

      const skills = await listSkillsWithMeta();
      if (skills.length > 0) {
        lines.push(`\n**Skills (${skills.length})**`);
        for (const skill of skills) {
          const info = skill.description
            ? `${skill.name} — ${skill.description.slice(0, 60)}${skill.description.length > 60 ? "..." : ""}`
            : skill.name;
          lines.push(`• ${info}`);
        }
      } else {
        lines.push("\nNo skills found in memory/skills/");
      }

      lines.push("\nUse /skills_list for details • /skill <name> to view one");
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    } catch (error) {
      logger.error("[MemoryCommands] /memfiles error:", error);
      await ctx.reply("Failed to list memory files");
    }
  });

  // /skills_list — list skills with OpenClaw metadata when available
  bot.command("skills_list", async (ctx) => {
    try {
      const skills = await listSkillsWithMeta();
      if (skills.length === 0) {
        await ctx.reply(
          "No skills found in memory/skills/\n" +
            "Add .md files or install from GitHub with /skill_install <url>",
        );
        return;
      }

      const lines = [`**Available Skills (${skills.length})**\n`];
      for (const skill of skills) {
        const meta: string[] = [];
        if (skill.category) meta.push(skill.category);
        if (skill.version) meta.push(`v${skill.version}`);
        const metaStr = meta.length > 0 ? ` _(${meta.join(" · ")})_` : "";
        lines.push(`• **${skill.name}**${metaStr}`);
        if (skill.description) {
          const desc = skill.description.length > 80
            ? `${skill.description.slice(0, 80)}...`
            : skill.description;
          lines.push(`  ${desc}`);
        }
      }

      lines.push("\n/skill <name> to view • /skill_install <url> to add");
      await ctx.reply(lines.join("\n"), { parse_mode: "Markdown" });
    } catch (error) {
      logger.error("[MemoryCommands] /skills_list error:", error);
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
          `Skill "${skillName}" not found.\nUse /skills_list to see available skills.`,
        );
        return;
      }

      await ctx.reply(`**Skill: ${skillName}**\n\n${truncate(content)}`, {
        parse_mode: "Markdown",
      });
    } catch (error) {
      logger.error("[MemoryCommands] /skill error:", error);
      await ctx.reply("Failed to read skill");
    }
  });

  // /skill_install <url> — install a skill from a GitHub URL (SKILL.md compatible)
  bot.command("skill_install", async (ctx) => {
    try {
      const rawArg = ctx.match?.trim();
      if (!rawArg) {
        await ctx.reply(
          "Usage: /skill_install <url>\n\n" +
            "Supports:\n" +
            "• Raw GitHub URLs: https://raw.githubusercontent.com/.../SKILL.md\n" +
            "• GitHub blob URLs: https://github.com/user/repo/blob/main/SKILL.md\n\n" +
            "Example:\n" +
            "/skill_install https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md",
        );
        return;
      }

      // Normalize GitHub blob URLs to raw URLs
      const url = rawArg.includes("github.com") && rawArg.includes("/blob/")
        ? toRawGitHubUrl(rawArg)
        : rawArg;

      const statusMsg = await ctx.reply("Downloading skill...");

      let content: string;
      try {
        content = await downloadUrl(url);
      } catch (downloadErr) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Failed to download skill: ${downloadErr instanceof Error ? downloadErr.message : "unknown error"}\n\nCheck the URL and try again.`,
        );
        return;
      }

      if (!content.trim()) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          "Downloaded file is empty.",
        );
        return;
      }

      // Extract skill name from frontmatter or filename from URL
      const parsed = parseSkillFrontmatter(content);
      const urlParts = url.split("/");
      const urlFilename = urlParts[urlParts.length - 1].replace(/\.md$/i, "");
      const skillName = parsed?.name ?? urlFilename ?? "unknown-skill";

      await writeSkill(skillName, content);

      const descLine = parsed?.description
        ? `\nDescription: ${parsed.description.slice(0, 100)}`
        : "";
      const categoryLine = parsed?.category ? `\nCategory: ${parsed.category}` : "";
      const versionLine = parsed?.version ? `\nVersion: ${parsed.version}` : "";

      await ctx.api.editMessageText(
        ctx.chat.id,
        statusMsg.message_id,
        `Skill installed: **${skillName}**${descLine}${categoryLine}${versionLine}\n\nUse /skill ${skillName} to view it.`,
        { parse_mode: "Markdown" },
      );

      logger.info(`[MemoryCommands] Installed skill from URL: ${skillName}`);
    } catch (error) {
      logger.error("[MemoryCommands] /skill_install error:", error);
      await ctx.reply("Failed to install skill. Check the URL and try again.");
    }
  });
}
