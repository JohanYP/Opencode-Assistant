import fs from "node:fs/promises";
import path from "node:path";
import { logger } from "../utils/logger.js";

/**
 * SQLite is the source of truth for skills, but mirroring each skill's
 * `.md` to `memory/skills/<name>.md` gives users a way to inspect,
 * back up, and version-control them — and gives the model a stable
 * directory to put auxiliary files (`memory/skills/<name>/script.py`,
 * data files, etc.) next to the documentation that references them.
 *
 * These helpers are best-effort: if the filesystem write fails, the
 * SQLite row is still authoritative and we log + continue.
 */

const SKILL_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{0,62}[a-z0-9])?$/;

export class InvalidSkillNameError extends Error {
  constructor(name: string) {
    super(
      `Invalid skill name "${name}". Use 1-64 chars: lowercase letters, digits, '-' or '_', not starting/ending with '-' or '_'.`,
    );
    this.name = "InvalidSkillNameError";
  }
}

export function assertValidSkillName(name: string): void {
  if (!SKILL_NAME_PATTERN.test(name)) {
    throw new InvalidSkillNameError(name);
  }
}

function getSkillsDir(): string {
  const memoryDir = process.env.MEMORY_DIR ?? "./memory";
  return path.resolve(memoryDir, "skills");
}

export function getSkillFilePath(name: string): string {
  assertValidSkillName(name);
  return path.join(getSkillsDir(), `${name}.md`);
}

export async function writeSkillFile(name: string, content: string): Promise<void> {
  assertValidSkillName(name);
  const filePath = getSkillFilePath(name);
  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  } catch (err) {
    logger.warn(
      `[Memory/SkillFiles] Failed to write ${filePath} (SQLite row still saved): ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

export async function removeSkillFile(name: string): Promise<void> {
  assertValidSkillName(name);
  const filePath = getSkillFilePath(name);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      // Already gone — fine.
      return;
    }
    logger.warn(
      `[Memory/SkillFiles] Failed to delete ${filePath}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
