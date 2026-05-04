import fs from "node:fs/promises";
import path from "node:path";
import type { Bot, Context } from "grammy";
import { config } from "../../config.js";
import { logger } from "../../utils/logger.js";
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
  countFactsMissingEmbedding,
  getFactsMissingEmbedding,
  updateFactEmbedding,
} from "../../memory/repositories/facts-vector.js";
import { getEmbeddingDriver } from "../../memory/embedding-driver.js";
import {
  getSkill,
  listSkills,
  verifySkillIntegrity,
} from "../../memory/repositories/skills.js";
import { appendAudit } from "../../memory/repositories/audit.js";
import {
  describeSkillStatuses,
  installSkillFromUrl,
  uninstallSkill,
  updateAllSkills,
  updateSkill,
  verifyAllSkills,
  type SkillStatus,
} from "../../memory/skill-service.js";
import { getUiPreferences, setUiPreferences } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";

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

function formatStatusFlag(status: SkillStatus): string {
  switch (status) {
    case "up-to-date":
      return "✓";
    case "local-only":
      return "(local)";
    case "requires-not-met":
      return "⚠ requires";
    case "no-frontmatter":
      return "⚠ no-frontmatter";
  }
}

function formatUpdateResult(result: {
  name: string;
  status: "updated" | "unchanged" | "no_source" | "not_found" | "error";
  oldSha256: string | null;
  newSha256: string | null;
  message?: string;
}): string {
  const shortSha = (s: string | null) => (s ? s.slice(0, 12) : "(none)");
  switch (result.status) {
    case "updated":
      return (
        `✓ Updated ${result.name}\n` +
        `  ${shortSha(result.oldSha256)} → ${shortSha(result.newSha256)}`
      );
    case "unchanged":
      return `= ${result.name} is already up-to-date (${shortSha(result.oldSha256)})`;
    case "no_source":
      return `− ${result.name}: no source URL stored (local skill)`;
    case "not_found":
      return `✗ ${result.name}: not installed`;
    case "error":
      return `✗ ${result.name}: ${result.message ?? "unknown error"}`;
  }
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

  // /personality [text] — view or replace the user-editable behaviour
  // rules document. Use this for things the assistant should consistently
  // follow ("dime siempre señor", "contesta en inglés", tone, formality,
  // response length) — distinct from facts about the user.
  bot.command("personality", async (ctx) => {
    try {
      const arg = ctx.match?.trim();
      if (arg) {
        setDocument("personality", arg);
        appendAudit("document_updated", { name: "personality", source: "telegram" });
        await ctx.reply(t("personality.updated"));
        return;
      }

      const doc = getDocument("personality");
      if (!doc || !doc.content.trim()) {
        await ctx.reply(t("personality.empty_help"));
        return;
      }
      await ctx.reply(`${t("personality.label")}\n\n${truncate(doc.content)}`);
    } catch (error) {
      logger.error("[MemoryCommands] /personality error:", error);
      await ctx.reply(t("personality.error"));
    }
  });

  // /show_tools <on|off> — toggle visibility of tool-call messages such
  // as "(Read memory.md)" or "(Edit foo.ts)". Persisted in settings.json.
  bot.command("show_tools", async (ctx) => {
    try {
      const arg = ctx.match?.trim().toLowerCase();
      const current = getUiPreferences().showToolMessages;

      if (!arg) {
        const stateLine = current
          ? t("show_tools.current_visible")
          : t("show_tools.current_hidden");
        await ctx.reply(`${stateLine}\n\n${t("show_tools.usage")}`);
        return;
      }

      let next: boolean;
      if (arg === "on" || arg === "true" || arg === "yes" || arg === "1") {
        next = true;
      } else if (arg === "off" || arg === "false" || arg === "no" || arg === "0") {
        next = false;
      } else {
        await ctx.reply(t("show_tools.invalid_value"));
        return;
      }

      await setUiPreferences({ showToolMessages: next });
      await ctx.reply(next ? t("show_tools.now_visible") : t("show_tools.now_hidden"));
    } catch (error) {
      logger.error("[MemoryCommands] /show_tools error:", error);
      await ctx.reply(t("show_tools.error"));
    }
  });

  // /inline_facts <on|off|N> — control how many recent facts get inlined
  // at session start. Sending "off" or "0" forces the model to call
  // fact_search via MCP for every memory query (useful for testing
  // vector recall). "on" restores the env-var default. A bare number
  // sets that value as the override.
  bot.command("inline_facts", async (ctx) => {
    try {
      const arg = ctx.match?.trim().toLowerCase();
      const override = getUiPreferences().inlineRecentFacts;
      const envDefault = config.memory.inlineRecentFacts;
      const effective = typeof override === "number" && override >= 0 ? override : envDefault;

      if (!arg) {
        await ctx.reply(
          t("inline_facts.current", {
            current: String(effective),
            override:
              typeof override === "number"
                ? t("inline_facts.override_user")
                : t("inline_facts.override_env"),
            env_default: String(envDefault),
          }) +
            "\n\n" +
            t("inline_facts.usage"),
        );
        return;
      }

      let next: number | null;
      if (arg === "off" || arg === "false" || arg === "no" || arg === "0") {
        next = 0;
      } else if (arg === "on" || arg === "true" || arg === "yes" || arg === "default") {
        next = null;
      } else {
        const parsed = Number.parseInt(arg, 10);
        if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
          await ctx.reply(t("inline_facts.invalid_value"));
          return;
        }
        next = parsed;
      }

      await setUiPreferences({ inlineRecentFacts: next });

      if (next === 0) {
        await ctx.reply(t("inline_facts.now_off"));
      } else if (next === null) {
        await ctx.reply(t("inline_facts.now_default", { env_default: String(envDefault) }));
      } else {
        await ctx.reply(t("inline_facts.now_set", { value: String(next) }));
      }
    } catch (error) {
      logger.error("[MemoryCommands] /inline_facts error:", error);
      await ctx.reply(t("inline_facts.error"));
    }
  });

  // /memory_reembed — backfill missing embeddings (and re-embed any vectors
  // produced by a different model). No-op without an embedding driver.
  bot.command("memory_reembed", async (ctx) => {
    try {
      const driver = getEmbeddingDriver();
      if (!driver) {
        await ctx.reply(t("memory.reembed.no_driver"));
        return;
      }

      const total = countFactsMissingEmbedding(driver.model);
      if (total === 0) {
        await ctx.reply(
          t("memory.reembed.complete", { processed: "0", failed: "0", model: driver.model }),
        );
        return;
      }

      await ctx.reply(t("memory.reembed.in_progress", { total: String(total) }));

      let processed = 0;
      let failed = 0;
      const BATCH_SIZE = 32;
      while (true) {
        const pending = getFactsMissingEmbedding(driver.model, BATCH_SIZE);
        if (pending.length === 0) break;

        const vectors = await driver
          .embedBatch(pending.map((f) => f.content))
          .catch((err: unknown) => {
            logger.warn("[MemoryCommands] /memory_reembed batch failed:", err);
            return null;
          });

        if (!vectors || vectors.length !== pending.length) {
          failed += pending.length;
          break;
        }

        for (let i = 0; i < pending.length; i++) {
          try {
            updateFactEmbedding(pending[i].id, vectors[i], driver.model);
            processed++;
          } catch (err) {
            logger.warn("[MemoryCommands] /memory_reembed update failed:", err);
            failed++;
          }
        }
      }

      appendAudit("facts_reembedded", { model: driver.model, processed, failed });
      await ctx.reply(
        t("memory.reembed.complete", {
          processed: String(processed),
          failed: String(failed),
          model: driver.model,
        }),
      );
    } catch (error) {
      logger.error("[MemoryCommands] /memory_reembed error:", error);
      await ctx.reply(t("memory.reembed.failed"));
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

  // /listskill — list installed skills grouped by category with status flag.
  bot.command("listskill", async (ctx) => {
    try {
      const items = describeSkillStatuses();
      if (items.length === 0) {
        await ctx.reply(
          "No skills installed.\nUse /skill_install <url> to add one.",
        );
        return;
      }

      // Group by category. Skills without a category land in "(uncategorized)".
      const grouped = new Map<string, Array<(typeof items)[number]>>();
      for (const item of items) {
        const key = item.skill.category ?? "(uncategorized)";
        const list = grouped.get(key) ?? [];
        list.push(item);
        grouped.set(key, list);
      }

      const orderedCategories = Array.from(grouped.keys()).sort((a, b) => {
        // Push the placeholder category to the end.
        if (a === "(uncategorized)") return 1;
        if (b === "(uncategorized)") return -1;
        return a.localeCompare(b);
      });

      const lines: string[] = [`Installed Skills (${items.length})\n`];
      for (const category of orderedCategories) {
        const list = grouped.get(category) ?? [];
        lines.push(`▸ ${category} (${list.length})`);
        for (const { skill, status } of list) {
          const flag = formatStatusFlag(status);
          const versionSuffix = skill.version ? ` v${skill.version}` : "";
          lines.push(`  • ${skill.name}${versionSuffix} ${flag}`);
          if (skill.description) {
            const desc =
              skill.description.length > 80
                ? `${skill.description.slice(0, 80)}...`
                : skill.description;
            lines.push(`    ${desc}`);
          }
        }
        lines.push("");
      }

      lines.push("/skill <name> · /skill_update [name] · /skill_remove <name>");
      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /listskill error:", error);
      await ctx.reply("Failed to list skills.");
    }
  });

  // /skill_verify — sha256 integrity check across all installed skills.
  bot.command("skill_verify", async (ctx) => {
    try {
      const results = verifyAllSkills();
      if (results.length === 0) {
        await ctx.reply("No skills installed.");
        return;
      }

      const failed = results.filter((r) => !r.match);
      const ok = results.length - failed.length;

      const lines = [`Skill Integrity Check (${results.length} skill(s))\n`];
      lines.push(`✓ ${ok} OK · ✗ ${failed.length} mismatch`);

      if (failed.length > 0) {
        lines.push("\nFailures:");
        for (const f of failed) {
          lines.push(`• ${f.name}`);
          lines.push(`  expected: ${f.expectedSha256?.slice(0, 12) ?? "(none)"}`);
          lines.push(`  actual:   ${f.actualSha256.slice(0, 12)}`);
        }
        lines.push("\nMismatches likely mean DB tampering or bit-rot.");
      }

      await ctx.reply(truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /skill_verify error:", error);
      await ctx.reply("Failed to verify skills.");
    }
  });

  // /skill_update [name] — re-download from source URL and update sha256.
  bot.command("skill_update", async (ctx) => {
    try {
      const arg = ctx.match?.trim();

      if (arg) {
        const skill = getSkill(arg);
        if (!skill) {
          await ctx.reply(`Skill "${arg}" not found.`);
          return;
        }
        const status = await ctx.reply(`Updating ${arg} from ${skill.sourceUrl ?? "?"}...`);
        const result = await updateSkill(arg);
        await ctx.api.editMessageText(
          ctx.chat.id,
          status.message_id,
          formatUpdateResult(result),
        );
        return;
      }

      const skills = listSkills();
      if (skills.length === 0) {
        await ctx.reply("No skills installed.");
        return;
      }
      const status = await ctx.reply(
        `Updating ${skills.length} skill(s) from their source URLs...`,
      );
      const results = await updateAllSkills();

      const updated = results.filter((r) => r.status === "updated");
      const unchanged = results.filter((r) => r.status === "unchanged");
      const noSource = results.filter((r) => r.status === "no_source");
      const errored = results.filter((r) => r.status === "error");

      const lines = [
        `Skill update done (${results.length} skill(s)):`,
        `  ✓ ${updated.length} updated`,
        `  = ${unchanged.length} already up-to-date`,
        `  − ${noSource.length} local-only (no source URL)`,
        `  ✗ ${errored.length} failed`,
      ];
      if (updated.length > 0) {
        lines.push("\nUpdated:");
        for (const r of updated) lines.push(`• ${r.name}`);
      }
      if (errored.length > 0) {
        lines.push("\nFailures:");
        for (const r of errored) {
          lines.push(`• ${r.name}: ${r.message ?? "unknown error"}`);
        }
      }

      await ctx.api.editMessageText(ctx.chat.id, status.message_id, truncate(lines.join("\n")));
    } catch (error) {
      logger.error("[MemoryCommands] /skill_update error:", error);
      await ctx.reply("Failed to update skill(s).");
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
      const ok = uninstallSkill(skillName, "telegram");
      if (!ok) {
        await ctx.reply(`Skill "${skillName}" was not installed.`);
        return;
      }
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

      const statusMsg = await ctx.reply("Downloading skill...");

      let result: Awaited<ReturnType<typeof installSkillFromUrl>>;
      try {
        result = await installSkillFromUrl(rawArg);
      } catch (err) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          statusMsg.message_id,
          `Failed to install skill: ${err instanceof Error ? err.message : "unknown error"}`,
        );
        return;
      }

      const { skill, slug, warnings } = result;
      const lines = [`Skill installed: ${slug}`];
      if (skill.description) lines.push(`Description: ${skill.description.slice(0, 100)}`);
      if (skill.category) lines.push(`Category: ${skill.category}`);
      if (skill.version) lines.push(`Version: ${skill.version}`);
      if (warnings.length > 0) {
        lines.push("", "⚠ Warnings:");
        for (const w of warnings) lines.push(`  • ${w}`);
      }
      lines.push("", `Use /skill ${slug} to view it.`);

      await ctx.api.editMessageText(ctx.chat.id, statusMsg.message_id, lines.join("\n"));
      logger.info(`[MemoryCommands] Installed skill from URL: ${slug}`);
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
