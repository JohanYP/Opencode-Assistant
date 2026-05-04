import fs from "node:fs/promises";
import { existsSync, mkdirSync, copyFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { logger } from "../utils/logger.js";
import { getDb } from "./db.js";
import { getDocument, setDocument, type DocumentName } from "./repositories/documents.js";
import { addFact } from "./repositories/facts.js";
import { installSkill } from "./repositories/skills.js";
import { appendAudit } from "./repositories/audit.js";

/**
 * Documents whose source of truth stays the user's markdown file.
 * They define identity (soul) and agent-selection rules (agents) — both
 * are intended to be human-edited and version-controlled, so the file
 * version always wins. Mutations through MCP/bot commands are explicitly
 * blocked for these names elsewhere.
 */
const FILE_TRACKED_DOCUMENTS: DocumentName[] = ["soul", "agents"];

const BACKUP_DIRNAME = ".pre-sqlite-backup";
const SOURCE_DOCUMENTS: DocumentName[] = ["soul", "agents", "context", "session-summary"];
const SOURCE_FLAT_FILES = [
  "soul.md",
  "agents.md",
  "context.md",
  "session-summary.md",
  "memory.md",
  "cron.yml",
];

export interface MigrationResult {
  alreadyMigrated: boolean;
  importedDocuments: number;
  importedFacts: number;
  importedSkills: number;
  importedScheduledTasks: number;
  backupPath: string | null;
}

export interface SyncIdentityResult {
  /** Names of documents whose SQLite row was overwritten from the file. */
  updated: DocumentName[];
}

/**
 * Imports legacy markdown/yaml memory files into SQLite. Idempotent: if the
 * DB already has any documents/facts/skills/scheduled_tasks rows, this is
 * a no-op. Always creates a backup of the source files before importing.
 *
 * Source layout (input):
 *   memory/soul.md, agents.md, context.md, session-summary.md
 *   memory/memory.md            -> bullets become rows in `facts`
 *   memory/skills/<name>.md     -> rows in `skills`
 *   memory/cron.yml             -> rows in `scheduled_tasks`
 *
 * Backup layout (output):
 *   memory/.pre-sqlite-backup/<files copied as-is>
 */
export async function migrateFromFiles(): Promise<MigrationResult> {
  const memoryDir = process.env.MEMORY_DIR ?? "./memory";
  const db = getDb();

  if (isDbAlreadyPopulated(db)) {
    logger.debug("[Memory/Migrate] SQLite already populated; skipping markdown import");
    return emptyResult(true);
  }

  if (!existsSync(memoryDir)) {
    logger.debug(`[Memory/Migrate] No memory directory at ${memoryDir}; nothing to migrate`);
    return emptyResult(false);
  }

  const backupPath = path.resolve(memoryDir, BACKUP_DIRNAME);
  backupSourceFiles(memoryDir, backupPath);

  const importedDocuments = await importDocuments(memoryDir);
  const importedFacts = await importMemoryFacts(memoryDir);
  const importedSkills = await importSkills(memoryDir);
  const importedScheduledTasks = await importScheduledTasks(memoryDir);

  appendAudit("memory_imported", {
    documents: importedDocuments,
    facts: importedFacts,
    skills: importedSkills,
    scheduledTasks: importedScheduledTasks,
    backupPath,
  });

  logger.info(
    `[Memory/Migrate] Imported ${importedDocuments} document(s), ${importedFacts} fact(s), ${importedSkills} skill(s), ${importedScheduledTasks} scheduled task(s). Backup at ${backupPath}.`,
  );

  return {
    alreadyMigrated: false,
    importedDocuments,
    importedFacts,
    importedSkills,
    importedScheduledTasks,
    backupPath,
  };
}

/**
 * Re-imports the file-tracked documents (soul, agents) from disk into
 * SQLite when the on-disk content differs from the SQLite row. Called
 * on every bot startup AFTER `migrateFromFiles` so user edits to
 * memory/soul.md or memory/agents.md propagate without forcing the
 * user to drop the database.
 *
 * Mutable documents (context, session-summary) and the facts table
 * are NEVER touched — those have SQLite as the source of truth and
 * resyncing them from file would clobber data the user added through
 * the bot or OpenCode tools.
 */
export async function syncIdentityDocumentsFromFiles(): Promise<SyncIdentityResult> {
  const memoryDir = process.env.MEMORY_DIR ?? "./memory";
  const updated: DocumentName[] = [];

  for (const name of FILE_TRACKED_DOCUMENTS) {
    const filePath = path.resolve(memoryDir, `${name}.md`);
    if (!existsSync(filePath)) continue;

    const fileContent = await fs.readFile(filePath, "utf-8");
    if (!fileContent.trim()) continue;

    const current = getDocument(name);
    if (current && current.content === fileContent) continue;

    setDocument(name, fileContent);
    updated.push(name);
    logger.info(
      `[Memory/Sync] ${name} document refreshed from ${filePath} (${fileContent.length} chars)`,
    );
  }

  if (updated.length > 0) {
    appendAudit("document_updated", {
      source: "file_sync_on_startup",
      names: updated,
    });
  }

  return { updated };
}

function isDbAlreadyPopulated(db: ReturnType<typeof getDb>): boolean {
  const facts = db.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number };
  const docs = db.prepare("SELECT COUNT(*) as c FROM documents").get() as { c: number };
  const skills = db.prepare("SELECT COUNT(*) as c FROM skills").get() as { c: number };
  const tasks = db.prepare("SELECT COUNT(*) as c FROM scheduled_tasks").get() as { c: number };
  return facts.c > 0 || docs.c > 0 || skills.c > 0 || tasks.c > 0;
}

function emptyResult(alreadyMigrated: boolean): MigrationResult {
  return {
    alreadyMigrated,
    importedDocuments: 0,
    importedFacts: 0,
    importedSkills: 0,
    importedScheduledTasks: 0,
    backupPath: null,
  };
}

function backupSourceFiles(memoryDir: string, backupDir: string): void {
  mkdirSync(backupDir, { recursive: true });

  for (const file of SOURCE_FLAT_FILES) {
    const src = path.join(memoryDir, file);
    if (existsSync(src)) {
      copyFileSync(src, path.join(backupDir, file));
    }
  }

  const skillsDir = path.join(memoryDir, "skills");
  if (existsSync(skillsDir) && statSync(skillsDir).isDirectory()) {
    const skillsBackup = path.join(backupDir, "skills");
    mkdirSync(skillsBackup, { recursive: true });
    for (const entry of readdirSync(skillsDir)) {
      if (entry.endsWith(".md")) {
        copyFileSync(path.join(skillsDir, entry), path.join(skillsBackup, entry));
      }
    }
  }
}

async function importDocuments(memoryDir: string): Promise<number> {
  let count = 0;
  for (const name of SOURCE_DOCUMENTS) {
    const filePath = path.resolve(memoryDir, `${name}.md`);
    if (!existsSync(filePath)) continue;
    const content = await fs.readFile(filePath, "utf-8");
    if (content.trim()) {
      setDocument(name, content);
      count++;
    }
  }
  return count;
}

async function importMemoryFacts(memoryDir: string): Promise<number> {
  const memoryMdPath = path.resolve(memoryDir, "memory.md");
  if (!existsSync(memoryMdPath)) return 0;

  const content = await fs.readFile(memoryMdPath, "utf-8");
  const factTexts = parseBulletFacts(content);
  for (const text of factTexts) {
    addFact({ category: "imported", content: text, source: "import" });
  }
  return factTexts.length;
}

async function importSkills(memoryDir: string): Promise<number> {
  const skillsDir = path.resolve(memoryDir, "skills");
  if (!existsSync(skillsDir) || !statSync(skillsDir).isDirectory()) return 0;

  let count = 0;
  for (const entry of readdirSync(skillsDir)) {
    if (!entry.endsWith(".md")) continue;
    const skillName = entry.replace(/\.md$/, "");
    const skillPath = path.join(skillsDir, entry);
    const content = await fs.readFile(skillPath, "utf-8");
    const meta = parseSkillFrontmatterShallow(content);

    installSkill({
      name: skillName,
      content,
      description: meta.description ?? null,
      category: meta.category ?? null,
      version: meta.version ?? null,
      sourceUrl: null,
    });
    count++;
  }
  return count;
}

async function importScheduledTasks(memoryDir: string): Promise<number> {
  const cronPath = path.resolve(memoryDir, "cron.yml");
  if (!existsSync(cronPath)) return 0;

  const raw = await fs.readFile(cronPath, "utf-8");
  let parsed: unknown;
  try {
    parsed = yaml.load(raw);
  } catch (error) {
    logger.warn("[Memory/Migrate] Failed to parse cron.yml; skipping:", error);
    return 0;
  }

  const crons = (parsed as { crons?: unknown })?.crons;
  if (!Array.isArray(crons) || crons.length === 0) return 0;

  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO scheduled_tasks (id, schedule, type, payload, enabled, last_run_at, next_run_at)
     VALUES (?, ?, ?, ?, 1, NULL, NULL)
     ON CONFLICT(id) DO NOTHING`,
  );

  let count = 0;
  for (const entry of crons) {
    if (!isCronEntry(entry)) continue;
    const { id, schedule, type, ...rest } = entry;
    insert.run(id, schedule, type, JSON.stringify(rest));
    count++;
  }
  return count;
}

function isCronEntry(value: unknown): value is { id: string; schedule: string; type: string } {
  if (!value || typeof value !== "object") return false;
  const v = value as { id?: unknown; schedule?: unknown; type?: unknown };
  return typeof v.id === "string" && typeof v.schedule === "string" && typeof v.type === "string";
}

/**
 * Splits a markdown body into atomic facts by extracting top-level bullet
 * lines (`- `, `* `, `+ `). Headings, horizontal rules, and intro
 * paragraphs are ignored. This is intentionally simple — power users that
 * want richer parsing can edit `memory.md` and re-run the import.
 */
export function parseBulletFacts(content: string): string[] {
  const facts: string[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    const match = /^[-*+]\s+(.+)$/.exec(trimmed);
    if (match) {
      const text = match[1].trim();
      if (text) facts.push(text);
    }
  }
  return facts;
}

/**
 * Lightweight YAML frontmatter reader to extract description/category/version
 * during the migration. Real validation is done in Phase 2 (skill polish).
 */
export function parseSkillFrontmatterShallow(content: string): {
  description?: string;
  category?: string;
  version?: string;
} {
  if (!content.startsWith("---")) return {};
  const endIndex = content.indexOf("\n---", 3);
  if (endIndex < 0) return {};
  const frontmatter = content.slice(3, endIndex);

  let parsed: unknown;
  try {
    parsed = yaml.load(frontmatter);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};

  const obj = parsed as Record<string, unknown>;
  const meta = (obj.metadata && typeof obj.metadata === "object"
    ? (obj.metadata as Record<string, unknown>)
    : {}) as Record<string, unknown>;

  return {
    description: typeof obj.description === "string" ? obj.description : undefined,
    category:
      typeof obj.category === "string"
        ? obj.category
        : typeof meta.category === "string"
          ? (meta.category as string)
          : undefined,
    version:
      typeof obj.version === "string"
        ? obj.version
        : typeof meta.version === "string"
          ? (meta.version as string)
          : undefined,
  };
}
