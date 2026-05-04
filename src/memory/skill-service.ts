import { logger } from "../utils/logger.js";
import { parseSkillFrontmatter } from "./manager.js";
import { appendAudit } from "./repositories/audit.js";
import {
  computeSha256,
  getSkill,
  installSkill,
  listSkills,
  removeSkill,
  verifySkillIntegrity,
  type Skill,
  type SkillIntegrityResult,
} from "./repositories/skills.js";
import { downloadUrl, toRawGitHubUrl } from "./skill-fetcher.js";

export interface InstallFromUrlResult {
  skill: Skill;
  /** What slug we ended up using (after parsing frontmatter and falling back to the URL). */
  slug: string;
  /** Frontmatter parsing warnings: missing required fields, etc. Empty array when clean. */
  warnings: string[];
}

export interface UpdateSkillResult {
  name: string;
  status: "updated" | "unchanged" | "no_source" | "not_found" | "error";
  /** Pre-update sha256 (null when status === "not_found"). */
  oldSha256: string | null;
  /** Post-update sha256 (null when status !== "updated"). */
  newSha256: string | null;
  message?: string;
}

const SKILL_FRONTMATTER_REQUIRED = ["name", "description"] as const;

/**
 * Validates that an installed skill exposes the conventional OpenClaw
 * frontmatter fields. Returns a list of human-readable warnings — never
 * throws and never blocks installation. Used by /skill_install and
 * /listskill to surface dodgy skills without breaking the flow.
 */
export function validateSkillFrontmatter(content: string): string[] {
  const parsed = parseSkillFrontmatter(content);
  if (!parsed) {
    return ['skill has no YAML frontmatter (expected "---" header with at least name + description)'];
  }
  const warnings: string[] = [];
  for (const field of SKILL_FRONTMATTER_REQUIRED) {
    if (!parsed[field]) {
      warnings.push(`frontmatter is missing required field: ${field}`);
    }
  }
  return warnings;
}

/**
 * Downloads a SKILL.md from a URL, parses the frontmatter, and installs
 * the skill into SQLite. The slug is taken from frontmatter.name when
 * present, otherwise from the URL filename. Mutates the audit log.
 */
export async function installSkillFromUrl(rawUrl: string): Promise<InstallFromUrlResult> {
  const url = toRawGitHubUrl(rawUrl);
  const content = await downloadUrl(url);
  if (!content.trim()) {
    throw new Error("Downloaded file is empty");
  }

  const parsed = parseSkillFrontmatter(content);
  const urlParts = url.split("/");
  const urlFilename = urlParts[urlParts.length - 1].replace(/\.md$/i, "");
  const rawName = parsed?.name ?? urlFilename ?? "unknown-skill";
  const slug =
    rawName.replace(/[^a-zA-Z0-9._-]/g, "-").replace(/^-+|-+$/g, "") || "skill";

  const skill = installSkill({
    name: slug,
    content,
    description: parsed?.description ?? null,
    category: parsed?.category ?? null,
    version: parsed?.version ?? null,
    sourceUrl: url,
  });

  appendAudit("skill_installed", {
    name: slug,
    sourceUrl: url,
    sha256: skill.sha256,
    source: "telegram",
  });

  return {
    skill,
    slug,
    warnings: validateSkillFrontmatter(content),
  };
}

/**
 * Re-downloads a single installed skill from its source URL and updates
 * SQLite when the sha256 differs. No-op (status="unchanged") when the
 * remote content matches what we already have. Returns "no_source" for
 * locally-added skills (no source_url stored).
 */
export async function updateSkill(name: string): Promise<UpdateSkillResult> {
  const existing = getSkill(name);
  if (!existing) {
    return {
      name,
      status: "not_found",
      oldSha256: null,
      newSha256: null,
      message: `Skill "${name}" not found`,
    };
  }
  if (!existing.sourceUrl) {
    return {
      name,
      status: "no_source",
      oldSha256: existing.sha256,
      newSha256: null,
      message: `Skill "${name}" has no source URL stored`,
    };
  }

  let content: string;
  try {
    content = await downloadUrl(existing.sourceUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[Memory/Skill] Failed to update ${name}:`, err);
    return {
      name,
      status: "error",
      oldSha256: existing.sha256,
      newSha256: null,
      message,
    };
  }

  if (!content.trim()) {
    return {
      name,
      status: "error",
      oldSha256: existing.sha256,
      newSha256: null,
      message: `Downloaded body is empty: ${existing.sourceUrl}`,
    };
  }

  const newSha = computeSha256(content);
  if (newSha === existing.sha256) {
    return {
      name,
      status: "unchanged",
      oldSha256: existing.sha256,
      newSha256: newSha,
    };
  }

  const parsed = parseSkillFrontmatter(content);
  installSkill({
    name,
    content,
    description: parsed?.description ?? existing.description,
    category: parsed?.category ?? existing.category,
    version: parsed?.version ?? existing.version,
    sourceUrl: existing.sourceUrl,
  });

  appendAudit("skill_updated", {
    name,
    sourceUrl: existing.sourceUrl,
    oldSha256: existing.sha256,
    newSha256: newSha,
  });

  return {
    name,
    status: "updated",
    oldSha256: existing.sha256,
    newSha256: newSha,
  };
}

/**
 * Updates every installed skill that has a source URL. Skills without a
 * source URL are reported as "no_source" but otherwise left alone.
 */
export async function updateAllSkills(): Promise<UpdateSkillResult[]> {
  const skills = listSkills();
  const results: UpdateSkillResult[] = [];
  for (const skill of skills) {
    results.push(await updateSkill(skill.name));
  }
  return results;
}

/**
 * Verifies the sha256 integrity of every installed skill: recomputes the
 * hash of the stored content and compares against the sha256 column.
 * Mismatches are logged in the audit table.
 */
export function verifyAllSkills(): SkillIntegrityResult[] {
  const skills = listSkills();
  const results: SkillIntegrityResult[] = [];
  for (const skill of skills) {
    const result = verifySkillIntegrity(skill.name);
    if (result) {
      results.push(result);
      if (!result.match) {
        appendAudit("skill_integrity_failed", {
          name: skill.name,
          expected: result.expectedSha256,
          actual: result.actualSha256,
        });
      }
    }
  }
  return results;
}

/**
 * Convenience for /skill_remove logic: removes the skill, appends the
 * matching audit entry. Centralized here so commands and a future cron
 * runner can share the same semantics.
 */
export function uninstallSkill(name: string, source: "telegram" | "cron" = "telegram"): boolean {
  const ok = removeSkill(name);
  if (ok) {
    appendAudit("skill_removed", { name, source });
  }
  return ok;
}

export type SkillStatus = "up-to-date" | "local-only" | "requires-not-met" | "no-frontmatter";

export interface SkillStatusInfo {
  skill: Skill;
  status: SkillStatus;
  warnings: string[];
}

/**
 * Computes a presentation-friendly status for every installed skill.
 * Used by /listskill to group + colour-code the catalogue.
 *
 * Note: "outdated" is intentionally NOT computed here because finding
 * out whether the upstream changed requires re-downloading every skill,
 * which is too expensive for a synchronous command. Use /skill_update
 * (or the future cron variant) for that check.
 */
export function describeSkillStatuses(): SkillStatusInfo[] {
  const skills = listSkills();
  return skills.map((skill) => {
    const warnings = validateSkillFrontmatter(skill.content);

    let status: SkillStatus;
    if (warnings.some((w) => w.includes("no YAML frontmatter"))) {
      status = "no-frontmatter";
    } else if (skill.requiresEnv.length > 0 || skill.requiresBins.length > 0) {
      status = "requires-not-met";
    } else if (!skill.sourceUrl) {
      status = "local-only";
    } else {
      status = "up-to-date";
    }

    return { skill, status, warnings };
  });
}
