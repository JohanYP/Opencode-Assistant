import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../../src/memory/db.js";
import {
  computeSha256,
  countSkills,
  getSkill,
  installSkill,
  listSkills,
  removeSkill,
  verifySkillIntegrity,
} from "../../../src/memory/repositories/skills.js";

describe("memory/repositories/skills", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-skills-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  it("computes a stable sha256 hash", () => {
    expect(computeSha256("hello")).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });

  it("installs a skill with metadata and reads it back", () => {
    const skill = installSkill({
      name: "code-review",
      content: "# Code review skill\n\nReview PRs.",
      description: "Reviews pull requests",
      category: "engineering",
      version: "1.0.0",
      sourceUrl: "https://example.com/code-review.md",
      requiresEnv: ["GITHUB_TOKEN"],
      requiresBins: ["gh"],
    });

    expect(skill.name).toBe("code-review");
    expect(skill.description).toBe("Reviews pull requests");
    expect(skill.category).toBe("engineering");
    expect(skill.version).toBe("1.0.0");
    expect(skill.sourceUrl).toBe("https://example.com/code-review.md");
    expect(skill.requiresEnv).toEqual(["GITHUB_TOKEN"]);
    expect(skill.requiresBins).toEqual(["gh"]);
    expect(skill.sha256).toBe(computeSha256(skill.content));

    const read = getSkill("code-review");
    expect(read).toEqual(skill);
  });

  it("returns null for a missing skill", () => {
    expect(getSkill("not-installed")).toBeNull();
  });

  it("preserves installed_at on update (upsert)", async () => {
    const first = installSkill({ name: "x", content: "v1" });
    await new Promise((r) => setTimeout(r, 5));
    const second = installSkill({ name: "x", content: "v2" });

    expect(second.installedAt).toBe(first.installedAt);
    expect(second.updatedAt > first.updatedAt).toBe(true);
    expect(second.content).toBe("v2");
    expect(second.sha256).not.toBe(first.sha256);
  });

  it("lists skills sorted alphabetically", () => {
    installSkill({ name: "zebra", content: "z" });
    installSkill({ name: "alpha", content: "a" });
    installSkill({ name: "mike", content: "m" });

    const names = listSkills().map((s) => s.name);
    expect(names).toEqual(["alpha", "mike", "zebra"]);
  });

  it("filters listSkills by category", () => {
    installSkill({ name: "git-worktree", content: "g", category: "engineering" });
    installSkill({ name: "summarize-meeting", content: "s", category: "productivity" });
    installSkill({ name: "review-pr", content: "r", category: "engineering" });

    const eng = listSkills({ category: "engineering" }).map((s) => s.name);
    expect(eng).toEqual(["git-worktree", "review-pr"]);
  });

  it("removes a skill", () => {
    installSkill({ name: "ephemeral", content: "x" });
    expect(removeSkill("ephemeral")).toBe(true);
    expect(getSkill("ephemeral")).toBeNull();
    expect(removeSkill("ephemeral")).toBe(false);
  });

  it("verifies integrity (match)", () => {
    const skill = installSkill({ name: "stable", content: "stable content" });
    const result = verifySkillIntegrity("stable");
    expect(result).not.toBeNull();
    expect(result!.match).toBe(true);
    expect(result!.expectedSha256).toBe(skill.sha256);
    expect(result!.actualSha256).toBe(skill.sha256);
  });

  it("returns null integrity result for a missing skill", () => {
    expect(verifySkillIntegrity("not-installed")).toBeNull();
  });

  it("counts skills", () => {
    expect(countSkills()).toBe(0);
    installSkill({ name: "a", content: "a" });
    installSkill({ name: "b", content: "b" });
    expect(countSkills()).toBe(2);
  });
});
