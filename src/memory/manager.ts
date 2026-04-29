import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

export type WritableMemoryFile = "memory" | "context" | "agents" | "skills";
export type MemoryFile = WritableMemoryFile | "soul";

const SESSION_SUMMARY_FILENAME = "session-summary.md";

const MEMORY_DIR = process.env.MEMORY_DIR ?? "./memory";

export function getMemoryDir(): string {
  return MEMORY_DIR;
}

export function getMemoryFilePath(name: MemoryFile): string {
  return path.resolve(MEMORY_DIR, `${name}.md`);
}

export function getSkillPath(skillName: string): string {
  return path.resolve(MEMORY_DIR, "skills", `${skillName}.md`);
}

export function getSkillsDir(): string {
  return path.resolve(MEMORY_DIR, "skills");
}

export function getCronYmlPath(): string {
  return path.resolve(MEMORY_DIR, "cron.yml");
}

export function getBackupsDir(): string {
  return path.resolve(MEMORY_DIR, "backups");
}

export async function readMemoryFile(name: MemoryFile): Promise<string> {
  try {
    const filePath = getMemoryFilePath(name);
    return await fs.readFile(filePath, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    logger.error(`[Memory] Error reading ${name}.md:`, error);
    return "";
  }
}

export async function writeMemoryFile(
  name: WritableMemoryFile,
  content: string,
): Promise<void> {
  try {
    const filePath = getMemoryFilePath(name);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
    logger.debug(`[Memory] Written ${name}.md`);
  } catch (error) {
    logger.error(`[Memory] Error writing ${name}.md:`, error);
    throw error;
  }
}

export async function appendMemoryFile(
  name: WritableMemoryFile,
  content: string,
): Promise<void> {
  const existing = await readMemoryFile(name);
  const separator = existing.trim() ? "\n\n" : "";
  await writeMemoryFile(name, `${existing}${separator}${content}`);
}

export async function listSkills(): Promise<string[]> {
  try {
    const skillsDir = getSkillsDir();
    const entries = await fs.readdir(skillsDir);
    return entries
      .filter((e) => e.endsWith(".md"))
      .map((e) => e.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

export interface SkillMeta {
  name: string;
  filename: string;
  description?: string;
  category?: string;
  version?: string;
  author?: string;
}

/**
 * Parses YAML frontmatter from an OpenClaw-compatible SKILL.md.
 * Returns null if there is no frontmatter.
 *
 * Format:
 * ---
 * name: skill-name
 * description: "When to use this skill"
 * metadata:
 *   version: 1.0.0
 *   category: engineering
 * ---
 */
export function parseSkillFrontmatter(content: string): Partial<SkillMeta> | null {
  if (!content.startsWith("---")) {
    return null;
  }

  const endIndex = content.indexOf("\n---", 3);
  if (endIndex < 0) {
    return null;
  }

  const frontmatter = content.slice(3, endIndex).trim();
  const meta: Partial<SkillMeta> = {};

  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const key = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line
      .slice(colonIdx + 1)
      .trim()
      .replace(/^["']|["']$/g, "");

    if (key === "name") meta.name = value;
    else if (key === "description") meta.description = value;
    else if (key === "category") meta.category = value;
    else if (key === "version") meta.version = value;
    else if (key === "author") meta.author = value;
  }

  return Object.keys(meta).length > 0 ? meta : null;
}

/**
 * Returns skills with metadata extracted from OpenClaw SKILL.md frontmatter.
 * Falls back gracefully to filename-only for skills without frontmatter.
 */
export async function listSkillsWithMeta(): Promise<SkillMeta[]> {
  const names = await listSkills();
  const results: SkillMeta[] = [];

  for (const filename of names) {
    const content = await readSkill(filename);
    const parsed = parseSkillFrontmatter(content);

    results.push({
      filename,
      name: parsed?.name ?? filename,
      description: parsed?.description,
      category: parsed?.category,
      version: parsed?.version,
      author: parsed?.author,
    });
  }

  return results;
}

export async function readSkill(skillName: string): Promise<string> {
  try {
    return await fs.readFile(getSkillPath(skillName), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    logger.error(`[Memory] Error reading skill ${skillName}:`, error);
    return "";
  }
}

export async function writeSkill(skillName: string, content: string): Promise<void> {
  try {
    const skillPath = getSkillPath(skillName);
    await fs.mkdir(path.dirname(skillPath), { recursive: true });
    await fs.writeFile(skillPath, content, "utf-8");
    logger.debug(`[Memory] Written skill: ${skillName}`);
  } catch (error) {
    logger.error(`[Memory] Error writing skill ${skillName}:`, error);
    throw error;
  }
}

export async function deleteSkill(skillName: string): Promise<void> {
  try {
    await fs.unlink(getSkillPath(skillName));
    logger.debug(`[Memory] Deleted skill: ${skillName}`);
  } catch (error) {
    logger.error(`[Memory] Error deleting skill ${skillName}:`, error);
    throw error;
  }
}

export async function backupMemory(): Promise<string> {
  const backupsDir = getBackupsDir();
  const dateStr = new Date().toISOString().slice(0, 10);
  const backupPath = path.join(backupsDir, dateStr);

  await fs.mkdir(backupPath, { recursive: true });

  const files: MemoryFile[] = ["soul", "memory", "context", "agents"];
  for (const name of files) {
    const content = await readMemoryFile(name);
    if (content) {
      await fs.writeFile(path.join(backupPath, `${name}.md`), content, "utf-8");
    }
  }

  // Backup skills
  const skills = await listSkills();
  if (skills.length > 0) {
    const skillsBackupDir = path.join(backupPath, "skills");
    await fs.mkdir(skillsBackupDir, { recursive: true });
    for (const skill of skills) {
      const content = await readSkill(skill);
      if (content) {
        await fs.writeFile(path.join(skillsBackupDir, `${skill}.md`), content, "utf-8");
      }
    }
  }

  logger.info(`[Memory] Backup created at ${backupPath}`);
  return backupPath;
}

// ── Session Summary ──────────────────────────────────────────────────────────

export function getSessionSummaryPath(): string {
  return path.resolve(MEMORY_DIR, SESSION_SUMMARY_FILENAME);
}

/**
 * Reads the session summary file.
 * Returns empty string if the file does not exist yet.
 */
export async function readSessionSummary(): Promise<string> {
  try {
    return await fs.readFile(getSessionSummaryPath(), "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    logger.error("[Memory] Error reading session-summary.md:", error);
    return "";
  }
}

/**
 * Writes (overwrites) the session summary file.
 * Called by the bot when the LLM updates the summary or via /summary command.
 */
export async function writeSessionSummary(content: string): Promise<void> {
  try {
    const summaryPath = getSessionSummaryPath();
    await fs.mkdir(path.dirname(summaryPath), { recursive: true });
    await fs.writeFile(summaryPath, content, "utf-8");
    logger.debug("[Memory] session-summary.md updated");
  } catch (error) {
    logger.error("[Memory] Error writing session-summary.md:", error);
    throw error;
  }
}
