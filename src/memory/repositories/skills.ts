import { createHash } from "node:crypto";
import { getDb } from "../db.js";

export interface Skill {
  name: string;
  content: string;
  description: string | null;
  category: string | null;
  version: string | null;
  sourceUrl: string | null;
  sha256: string | null;
  installedAt: string;
  updatedAt: string;
  requiresEnv: string[];
  requiresBins: string[];
}

interface SkillRow {
  name: string;
  content: string;
  description: string | null;
  category: string | null;
  version: string | null;
  source_url: string | null;
  sha256: string | null;
  installed_at: string;
  updated_at: string;
  requires_env: string | null;
  requires_bins: string | null;
}

export interface InstallSkillInput {
  name: string;
  content: string;
  description?: string | null;
  category?: string | null;
  version?: string | null;
  sourceUrl?: string | null;
  requiresEnv?: string[];
  requiresBins?: string[];
}

const SELECT_COLUMNS = `
  name, content, description, category, version,
  source_url, sha256, installed_at, updated_at,
  requires_env, requires_bins
`;

function rowToSkill(row: SkillRow): Skill {
  return {
    name: row.name,
    content: row.content,
    description: row.description,
    category: row.category,
    version: row.version,
    sourceUrl: row.source_url,
    sha256: row.sha256,
    installedAt: row.installed_at,
    updatedAt: row.updated_at,
    requiresEnv: parseJsonArray(row.requires_env),
    requiresBins: parseJsonArray(row.requires_bins),
  };
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export function installSkill(input: InstallSkillInput): Skill {
  const db = getDb();
  const now = new Date().toISOString();
  const sha = computeSha256(input.content);
  const requiresEnvJson = JSON.stringify(input.requiresEnv ?? []);
  const requiresBinsJson = JSON.stringify(input.requiresBins ?? []);

  const existing = db
    .prepare("SELECT installed_at FROM skills WHERE name = ?")
    .get(input.name) as { installed_at: string } | undefined;

  const installedAt = existing?.installed_at ?? now;

  db.prepare(
    `INSERT INTO skills (
      name, content, description, category, version,
      source_url, sha256, installed_at, updated_at,
      requires_env, requires_bins
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      content = excluded.content,
      description = excluded.description,
      category = excluded.category,
      version = excluded.version,
      source_url = excluded.source_url,
      sha256 = excluded.sha256,
      updated_at = excluded.updated_at,
      requires_env = excluded.requires_env,
      requires_bins = excluded.requires_bins`,
  ).run(
    input.name,
    input.content,
    input.description ?? null,
    input.category ?? null,
    input.version ?? null,
    input.sourceUrl ?? null,
    sha,
    installedAt,
    now,
    requiresEnvJson,
    requiresBinsJson,
  );

  const fresh = getSkill(input.name);
  if (!fresh) {
    throw new Error(`Failed to read back skill ${input.name}`);
  }
  return fresh;
}

export function getSkill(name: string): Skill | null {
  const db = getDb();
  const row = db.prepare(`SELECT ${SELECT_COLUMNS} FROM skills WHERE name = ?`).get(name) as
    | SkillRow
    | undefined;
  return row ? rowToSkill(row) : null;
}

export interface ListSkillsOptions {
  category?: string;
}

export function listSkills(options: ListSkillsOptions = {}): Skill[] {
  const db = getDb();
  if (options.category) {
    const rows = db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM skills WHERE category = ? ORDER BY name`)
      .all(options.category) as SkillRow[];
    return rows.map(rowToSkill);
  }
  const rows = db
    .prepare(`SELECT ${SELECT_COLUMNS} FROM skills ORDER BY name`)
    .all() as SkillRow[];
  return rows.map(rowToSkill);
}

export function removeSkill(name: string): boolean {
  const db = getDb();
  const result = db.prepare("DELETE FROM skills WHERE name = ?").run(name);
  return result.changes > 0;
}

export interface SkillIntegrityResult {
  name: string;
  expectedSha256: string | null;
  actualSha256: string;
  match: boolean;
}

export function verifySkillIntegrity(name: string): SkillIntegrityResult | null {
  const skill = getSkill(name);
  if (!skill) return null;
  const actual = computeSha256(skill.content);
  return {
    name: skill.name,
    expectedSha256: skill.sha256,
    actualSha256: actual,
    match: skill.sha256 === actual,
  };
}

export function countSkills(): number {
  const db = getDb();
  const row = db.prepare("SELECT COUNT(*) as c FROM skills").get() as { c: number };
  return row.c;
}
