import https from "node:https";
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import type { Bot, Context } from "grammy";
import { logger } from "../../utils/logger.js";
import { parseSkillFrontmatter } from "../../memory/manager.js";
import {
  getDocument,
  listDocuments,
  setDocument,
  type DocumentName,
} from "../../memory/repositories/documents.js";
import {
  addFact,
  countFacts,
  deleteFact,
  getFactById,
  getRecentFacts,
  searchFacts,
} from "../../memory/repositories/facts.js";
import {
  getSkill,
  installSkill,
  listSkills,
  removeSkill,
  verifySkillIntegrity,
} from "../../memory/repositories/skills.js";
import { appendAudit } from "../../memory/repositories/audit.js";

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

function toRawGitHubUrl(url: string): string {
  return url
    .replace("https://github.com/", "https://raw.githubusercontent.com/")
    .replace("/blob/", "/");
}

const MAX_TELEGRAM_MESSAGE = 4000;

function truncate(text: string): string {
  if (text.length <= MAX_TELEGRAM_MESSAGE) {
    return text;
  }
  return `${text.slice(0, MAX_TELEGRAM_MESSAGE)}\n\n...(truncated)`;
}

async function sendDocument(
  ctx: Context,
  name: DocumentName,
  label: string,
): Promise<void> {
  const doc = getDocument(name);
  const content = doc?.content ?? "";
  if (!content.trim()) {
    await ctx.reply(`${label} is empty.`);
    return;
  }
  await ctx.reply(`${label}\n\n${truncate(content)}`);
}

function formatFactLine(fact: {
  id: number;
  category: string | null;
  content: string;
}): string {
  const categoryTag = fact.category ? `[${fact.category}] ` : "";
  return `#${fact.id} ${categoryTag}${fact.content}`;
}

/**
 * Registers the memory/skill bot commands. All reads and writes go through
 * the SQLite-backed repositories — the legacy markdown files are imported
 * once at startup and then live as the on-disk export at memory/.pre-sqlite-backup/.
 */
export function registerMemoryCommands(bot: Bot<Context>): void {
  // /soul — view soul document (read-only)
  bot.command("soul", async (ctx) => {
    try {
      await sendDocument(ctx, "soul", "Soul");
    } catch (error) {
      logger.error("[MemoryCommands] /soul error:", error);
      await ctx.reply("Failed to read soul document.");
    }
  });

  // /agents_md — view agents document (read-only)
  bot.command("agents_md", async (ctx) => {
    try {
      await sendDocument(ctx, "agents", "Agents");
    } catch (error) {
      logger.error("[MemoryCommands] /agents_md error:", error);
      await ctx.reply("Failed to read agents document.");
    }
  });

  // /context [text] — view or replace the project-context document.
  bot.command("context", async (ctx) => {
    try {
      const arg = ctx.match?.trim();
      if (arg) {
        setDocument("context", arg);
        appendAudit("document_updated", { name: "context", source: "telegram" });
        await ctx.reply("Context updated.");
        return;
      }
      await sendDocument(ctx, "context", "Context");
    } catch (error) {
      logger.error("[MemoryCommands] /context error:", error);
      await ctx.reply("Failed to access context.");
    }
  });

  // /memory [text] — list recent facts, or save a new atomic fact.
  bot.command("memory", async (ctx) => {
    try {
      const arg = ctx.match?.trim();
      if (arg) {
        const fact = addFact({ content: arg, source: "telegram" });
        appendAudit("fact_added", { id: fact.id, source: "telegram" });
        await ctx.reply(`Saved fact #${fact.id}: ${fact.content}`);
        return;
      }

      const recent = getRecentFacts(20);
      if (recent.length === 0) {
        await ctx.reply(
          "No facts saved yet.\n" +
            "Use /memory <text> to save one, or /memory_search <query> to search.",
        );
        return;
      }

      const lines = [`Recent memory (${recent.length} of ${countFacts()} fact(s)):\n`];
      for (const f of recent) {
        lines.push(formatFactLine(f));
      }
      lines.push("\n/memory <text> to save • /memory_search <query> to filter");
      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /memory error:", error);
      await ctx.reply("Failed to access memory.");
    }
  });

  // /memory_search <query> — substring search over saved facts.
  bot.command("memory_search", async (ctx) => {
    try {
      const query = ctx.match?.trim();
      if (!query) {
        await ctx.reply("Usage: /memory_search <query>");
        return;
      }
      const results = searchFacts(query, { limit: 30 });
      if (results.length === 0) {
        await ctx.reply(`No facts match "${query}".`);
        return;
      }
      const lines = [`Matches for "${query}" (${results.length}):\n`];
      for (const f of results) {
        lines.push(formatFactLine(f));
      }
      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /memory_search error:", error);
      await ctx.reply("Failed to search memory.");
    }
  });

  // /memory_remove <id> — delete a fact by id.
  bot.command("memory_remove", async (ctx) => {
    try {
      const raw = ctx.match?.trim();
      if (!raw) {
        await ctx.reply("Usage: /memory_remove <id>");
        return;
      }
      const id = Number.parseInt(raw, 10);
      if (Number.isNaN(id) || id <= 0) {
        await ctx.reply("Invalid id. Use /memory to list facts with their ids.");
        return;
      }
      const fact = getFactById(id);
      if (!fact) {
        await ctx.reply(`Fact #${id} not found.`);
        return;
      }
      const ok = deleteFact(id);
      if (ok) {
        appendAudit("fact_deleted", { id, content: fact.content });
        await ctx.reply(`Deleted fact #${id}: ${fact.content}`);
      } else {
        await ctx.reply(`Failed to delete fact #${id}.`);
      }
    } catch (error) {
      logger.error("[MemoryCommands] /memory_remove error:", error);
      await ctx.reply("Failed to delete fact.");
    }
  });

  // /memfiles — overview of memory state.
  bot.command("memfiles", async (ctx) => {
    try {
      const docs = listDocuments();
      const docByName = new Map(docs.map((d) => [d.name, d]));

      const docOrder: DocumentName[] = ["soul", "agents", "context", "session-summary"];
      const lines: string[] = ["Memory (SQLite)\n"];

      lines.push("Documents:");
      for (const name of docOrder) {
        const doc = docByName.get(name);
        const size = doc?.content.length ?? 0;
        const flag = size > 0 ? "✓" : "empty";
        lines.push(`• ${name} — ${size} chars ${flag}`);
      }

      const facts = countFacts();
      lines.push(`\nFacts: ${facts}`);

      const skills = listSkills();
      lines.push(`\nSkills (${skills.length})`);
      for (const skill of skills) {
        const meta: string[] = [];
        if (skill.category) meta.push(skill.category);
        if (skill.version) meta.push(`v${skill.version}`);
        const metaStr = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
        const desc = skill.description
          ? `${skill.description.slice(0, 60)}${skill.description.length > 60 ? "..." : ""}`
          : "";
        lines.push(`• ${skill.name}${metaStr}${desc ? ` — ${desc}` : ""}`);
      }

      lines.push(
        "\n/listskill • /skill <name> • /memory_search <q> • /memory_export to dump to .md",
      );
      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /memfiles error:", error);
      await ctx.reply("Failed to summarize memory.");
    }
  });

  // /listskill — list installed skills with metadata.
  bot.command("listskill", async (ctx) => {
    try {
      const skills = listSkills();
      if (skills.length === 0) {
        await ctx.reply(
          "No skills installed.\nUse /skill_install <url> to add one.",
        );
        return;
      }

      const lines = [`Installed Skills (${skills.length})\n`];
      for (const skill of skills) {
        const meta: string[] = [];
        if (skill.category) meta.push(skill.category);
        if (skill.version) meta.push(`v${skill.version}`);
        const metaStr = meta.length > 0 ? ` (${meta.join(" · ")})` : "";
        lines.push(`• ${skill.name}${metaStr}`);
        if (skill.description) {
          const desc =
            skill.description.length > 80
              ? `${skill.description.slice(0, 80)}...`
              : skill.description;
          lines.push(`  ${desc}`);
        }
      }

      lines.push("\n/skill <name> to view • /skill_remove <name> to delete");
      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /listskill error:", error);
      await ctx.reply("Failed to list skills.");
    }
  });

  // /skill <name> — view a specific skill.
  bot.command("skill", async (ctx) => {
    try {
      const skillName = ctx.match?.trim();
      if (!skillName) {
        await ctx.reply("Usage: /skill <name>\nExample: /skill web-search");
        return;
      }

      const skill = getSkill(skillName);
      if (!skill) {
        await ctx.reply(
          `Skill "${skillName}" not found.\nUse /listskill to see available skills.`,
        );
        return;
      }

      const integrity = verifySkillIntegrity(skillName);
      const integritySuffix =
        integrity && integrity.match
          ? ""
          : `\n\n⚠ Integrity check failed (sha256 changed since install).`;

      await ctx.reply(`Skill: ${skillName}${integritySuffix}\n\n${truncate(skill.content)}`);
    } catch (error) {
      logger.error("[MemoryCommands] /skill error:", error);
      await ctx.reply("Failed to read skill.");
    }
  });

  // /skill_remove <name> — uninstall a skill.
  bot.command("skill_remove", async (ctx) => {
    try {
      const skillName = ctx.match?.trim();
      if (!skillName) {
        await ctx.reply("Usage: /skill_remove <name>");
        return;
      }
      const ok = removeSkill(skillName);
      if (!ok) {
        await ctx.reply(`Skill "${skillName}" was not installed.`);
        return;
      }
      appendAudit("skill_removed", { name: skillName, source: "telegram" });
      await ctx.reply(`Removed skill: ${skillName}`);
    } catch (error) {
      logger.error("[MemoryCommands] /skill_remove error:", error);
      await ctx.reply("Failed to remove skill.");
    }
  });

  // /skill_install <url> — fetch a SKILL.md from a URL and store it in SQLite.
  bot.command("skill_install", async (ctx) => {
    try {
      const rawArg = ctx.match?.trim();
      if (!rawArg) {
        await ctx.reply(
          "Usage: /skill_install <url>\n\n" +
            "Supports raw GitHub URLs and github.com/.../blob/... URLs.\n" +
            "Example:\n" +
            "/skill_install https://raw.githubusercontent.com/alirezarezvani/claude-skills/main/engineering/git-worktree-manager/SKILL.md",
        );
        return;
      }

      const url =
        rawArg.includes("github.com") && rawArg.includes("/blob/")
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
          `Failed to download skill: ${downloadErr instanceof Error ? downloadErr.message : "unknown error"}`,
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

      const parsed = parseSkillFrontmatter(content);
      const urlParts = url.split("/");
      const urlFilename = urlParts[urlParts.length - 1].replace(/\.md$/i, "");
      const rawName = parsed?.name ?? urlFilename ?? "unknown-skill";
      const skillName =
        rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "skill";

      const skill = installSkill({
        name: skillName,
        content,
        description: parsed?.description ?? null,
        category: parsed?.category ?? null,
        version: parsed?.version ?? null,
        sourceUrl: url,
      });
      appendAudit("skill_installed", {
        name: skillName,
        sourceUrl: url,
        sha256: skill.sha256,
        source: "telegram",
      });

      const lines = [`Skill installed: ${skillName}`];
      if (parsed?.description) lines.push(`Description: ${parsed.description.slice(0, 100)}`);
      if (parsed?.category) lines.push(`Category: ${parsed.category}`);
      if (parsed?.version) lines.push(`Version: ${parsed.version}`);
      lines.push("", `Use /skill ${skillName} to view it.`);

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, lines.join("\n"));
      logger.info(`[MemoryCommands] Installed skill from URL: ${skillName}`);
    } catch (error) {
      logger.error("[MemoryCommands] /skill_install error:", error);
      await ctx.reply("Failed to install skill. Check the URL and try again.");
    }
  });

  // /memory_export — dump all memory to memory/export-<timestamp>/ as .md files.
  bot.command("memory_export", async (ctx) => {
    try {
      const memoryDir = process.env.MEMORY_DIR ?? "./memory";
      const ts = new Date().toISOString().replace(/[:.]/g, "-");
      const exportDir = path.resolve(memoryDir, `export-${ts}`);
      await fs.mkdir(exportDir, { recursive: true });

      // Documents -> <name>.md
      const docs = listDocuments();
      let docCount = 0;
      for (const doc of docs) {
        if (doc.content.trim()) {
          await fs.writeFile(path.join(exportDir, `${doc.name}.md`), doc.content, "utf-8");
          docCount++;
        }
      }

      // Facts -> memory.md as bullets, prefixed by category if present
      const allFacts = getRecentFacts(10000);
      if (allFacts.length > 0) {
        const lines = ["# Memory", "", "Long-term facts.", ""];
        for (const f of allFacts.slice().reverse()) {
          const cat = f.category ? `[${f.category}] ` : "";
          lines.push(`- ${cat}${f.content}`);
        }
        await fs.writeFile(path.join(exportDir, "memory.md"), lines.join("\n"), "utf-8");
      }

      // Skills -> skills/<name>.md
      const skills = listSkills();
      if (skills.length > 0) {
        const skillsDir = path.join(exportDir, "skills");
        await fs.mkdir(skillsDir, { recursive: true });
        for (const skill of skills) {
          await fs.writeFile(path.join(skillsDir, `${skill.name}.md`), skill.content, "utf-8");
        }
      }

      appendAudit("memory_exported", {
        path: exportDir,
        documents: docCount,
        facts: allFacts.length,
        skills: skills.length,
      });

      await ctx.reply(
        [
          `Exported memory to:`,
          exportDir,
          ``,
          `${docCount} document(s), ${allFacts.length} fact(s), ${skills.length} skill(s)`,
        ].join("\n"),
      );
    } catch (error) {
      logger.error("[MemoryCommands] /memory_export error:", error);
      await ctx.reply("Failed to export memory.");
    }
  });
}
