import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../src/memory/db.js";
import {
  migrateFromFiles,
  parseBulletFacts,
  parseSkillFrontmatterShallow,
} from "../../src/memory/migrate-from-files.js";
import { listDocuments } from "../../src/memory/repositories/documents.js";
import { countFacts, getRecentFacts } from "../../src/memory/repositories/facts.js";
import { listSkills } from "../../src/memory/repositories/skills.js";
import { getAudit } from "../../src/memory/repositories/audit.js";

describe("memory/migrate-from-files", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-migrate-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  function writeFile(rel: string, content: string): void {
    const fullPath = path.join(tempDir, rel);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf-8");
  }

  describe("parseBulletFacts", () => {
    it("extracts bullets prefixed with -, *, +", () => {
      const md = [
        "# Memory",
        "",
        "- prefers TypeScript",
        "* uses Vim",
        "+ has a dog named Rex",
        "",
        "Some prose that should be ignored.",
      ].join("\n");
      expect(parseBulletFacts(md)).toEqual([
        "prefers TypeScript",
        "uses Vim",
        "has a dog named Rex",
      ]);
    });

    it("returns empty array for content without bullets", () => {
      expect(parseBulletFacts("# Memory\n\nNo bullets here.")).toEqual([]);
    });

    it("trims surrounding whitespace from bullets", () => {
      expect(parseBulletFacts("  -    spaced fact  ")).toEqual(["spaced fact"]);
    });

    it("ignores empty bullets", () => {
      expect(parseBulletFacts("- \n- real fact\n-")).toEqual(["real fact"]);
    });
  });

  describe("parseSkillFrontmatterShallow", () => {
    it("returns empty object when no frontmatter", () => {
      expect(parseSkillFrontmatterShallow("# No frontmatter here")).toEqual({});
    });

    it("extracts description, category, and version from top-level fields", () => {
      const content = [
        "---",
        "name: test",
        'description: "A test skill"',
        "category: engineering",
        "version: 1.0.0",
        "---",
        "",
        "# Body",
      ].join("\n");
      expect(parseSkillFrontmatterShallow(content)).toEqual({
        description: "A test skill",
        category: "engineering",
        version: "1.0.0",
      });
    });

    it("falls back to metadata.category and metadata.version when not at top level", () => {
      const content = [
        "---",
        "name: nested",
        'description: "x"',
        "metadata:",
        "  category: productivity",
        "  version: 2.0.0",
        "---",
        "",
        "Body.",
      ].join("\n");
      expect(parseSkillFrontmatterShallow(content)).toEqual({
        description: "x",
        category: "productivity",
        version: "2.0.0",
      });
    });

    it("returns empty when frontmatter is malformed", () => {
      const content = "---\nname: bad\n  garbage\n---\nbody";
      const result = parseSkillFrontmatterShallow(content);
      // Should NOT throw, may return partial; we just verify no crash and the
      // result is an object.
      expect(typeof result).toBe("object");
    });
  });

  describe("migrateFromFiles", () => {
    it("is a no-op when there is no memory directory", async () => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      // Re-create empty so SQLite has somewhere to live.
      fs.mkdirSync(tempDir, { recursive: true });
      // But remove EVERY .md so nothing imports.
      const result = await migrateFromFiles();
      expect(result.alreadyMigrated).toBe(false);
      expect(result.importedDocuments).toBe(0);
      expect(result.importedFacts).toBe(0);
      expect(result.importedSkills).toBe(0);
    });

    it("imports documents, facts, and skills end-to-end", async () => {
      writeFile("soul.md", "# Soul\n\nI am a helpful assistant.");
      writeFile("agents.md", "# Agents\n\nUse build by default.");
      writeFile("context.md", "# Context\n\nCurrent project: test.");
      writeFile("session-summary.md", "# Summary\n\nNothing yet.");
      writeFile(
        "memory.md",
        ["# Memory", "", "- prefers TypeScript", "- works in Madrid", ""].join("\n"),
      );
      writeFile(
        "skills/web-search.md",
        ["---", "name: web-search", 'description: "Search the web"', "category: research", "---", "", "Body."].join(
          "\n",
        ),
      );
      writeFile("skills/code-review.md", "# Code Review\n\nReview PRs.");

      const result = await migrateFromFiles();

      expect(result.alreadyMigrated).toBe(false);
      expect(result.importedDocuments).toBe(4);
      expect(result.importedFacts).toBe(2);
      expect(result.importedSkills).toBe(2);
      expect(result.backupPath).toContain(".pre-sqlite-backup");

      const docs = listDocuments();
      expect(docs.map((d) => d.name).sort()).toEqual([
        "agents",
        "context",
        "session-summary",
        "soul",
      ]);

      expect(countFacts()).toBe(2);
      const facts = getRecentFacts(10);
      expect(facts.map((f) => f.content).sort()).toEqual([
        "prefers TypeScript",
        "works in Madrid",
      ]);
      for (const f of facts) {
        expect(f.category).toBe("imported");
        expect(f.source).toBe("import");
      }

      const skills = listSkills();
      expect(skills.map((s) => s.name).sort()).toEqual(["code-review", "web-search"]);
      const webSearch = skills.find((s) => s.name === "web-search")!;
      expect(webSearch.description).toBe("Search the web");
      expect(webSearch.category).toBe("research");
    });

    it("creates a backup of source files before importing", async () => {
      writeFile("soul.md", "soul content");
      writeFile("memory.md", "- a fact");
      writeFile("skills/test.md", "skill content");

      const result = await migrateFromFiles();
      expect(result.backupPath).not.toBeNull();
      expect(fs.existsSync(result.backupPath!)).toBe(true);
      expect(fs.existsSync(path.join(result.backupPath!, "soul.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.backupPath!, "memory.md"))).toBe(true);
      expect(fs.existsSync(path.join(result.backupPath!, "skills", "test.md"))).toBe(true);
    });

    it("is idempotent: re-running on a populated DB is a no-op", async () => {
      writeFile("memory.md", "- first fact");
      const first = await migrateFromFiles();
      expect(first.alreadyMigrated).toBe(false);
      expect(first.importedFacts).toBe(1);

      // Add a new bullet to the source — it should NOT be imported again
      // because the DB is already populated.
      writeFile("memory.md", "- first fact\n- second fact");
      const second = await migrateFromFiles();
      expect(second.alreadyMigrated).toBe(true);
      expect(second.importedFacts).toBe(0);

      expect(countFacts()).toBe(1);
    });

    it("imports cron.yml entries into scheduled_tasks", async () => {
      writeFile(
        "cron.yml",
        [
          "crons:",
          "  - id: daily",
          '    schedule: "0 8 * * *"',
          "    type: task",
          '    prompt: "Hello"',
          '    timezone: "UTC"',
          "  - id: weekly-backup",
          '    schedule: "0 0 * * 0"',
          "    type: backup",
          "",
        ].join("\n"),
      );

      const result = await migrateFromFiles();
      expect(result.importedScheduledTasks).toBe(2);
    });

    it("ignores empty cron.yml gracefully", async () => {
      writeFile("cron.yml", "crons: []\n");
      const result = await migrateFromFiles();
      expect(result.importedScheduledTasks).toBe(0);
    });

    it("appends an audit entry on successful migration", async () => {
      writeFile("memory.md", "- only fact");
      await migrateFromFiles();

      const audit = getAudit({ event: "memory_imported" });
      expect(audit).toHaveLength(1);
      const payload = audit[0].payload as Record<string, unknown>;
      expect(payload.facts).toBe(1);
    });
  });
});
