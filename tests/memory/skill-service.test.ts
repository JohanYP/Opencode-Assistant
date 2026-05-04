import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetcherMock = vi.hoisted(() => ({
  downloadUrl: vi.fn<(url: string) => Promise<string>>(),
  toRawGitHubUrl: vi.fn((url: string) => url),
}));

vi.mock("../../src/memory/skill-fetcher.js", () => fetcherMock);

import { closeDb, resetDbInstance } from "../../src/memory/db.js";
import { getAudit } from "../../src/memory/repositories/audit.js";
import {
  computeSha256,
  getSkill,
  installSkill,
  listSkills,
} from "../../src/memory/repositories/skills.js";
import {
  describeSkillStatuses,
  installSkillFromUrl,
  uninstallSkill,
  updateAllSkills,
  updateSkill,
  validateSkillFrontmatter,
  verifyAllSkills,
} from "../../src/memory/skill-service.js";

describe("memory/skill-service", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-skill-svc-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
    fetcherMock.downloadUrl.mockReset();
    fetcherMock.toRawGitHubUrl.mockReset();
    fetcherMock.toRawGitHubUrl.mockImplementation((url: string) => url);
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  describe("validateSkillFrontmatter", () => {
    it("flags content without any frontmatter", () => {
      const warnings = validateSkillFrontmatter("# Just a heading\n\nbody");
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toMatch(/no YAML frontmatter/);
    });

    it("flags missing name and description", () => {
      const content = ["---", "category: engineering", "---", "", "body"].join("\n");
      const warnings = validateSkillFrontmatter(content);
      expect(warnings).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/missing required field: name/),
          expect.stringMatching(/missing required field: description/),
        ]),
      );
    });

    it("returns no warnings when name and description are present", () => {
      const content = [
        "---",
        "name: web-search",
        'description: "Search the web"',
        "---",
        "",
        "body",
      ].join("\n");
      expect(validateSkillFrontmatter(content)).toEqual([]);
    });
  });

  describe("installSkillFromUrl", () => {
    it("downloads, parses, installs, and writes an audit entry", async () => {
      const content = [
        "---",
        "name: test-skill",
        'description: "Test skill"',
        "category: testing",
        "---",
        "",
        "Body",
      ].join("\n");
      fetcherMock.downloadUrl.mockResolvedValueOnce(content);

      const result = await installSkillFromUrl("https://example.com/skill.md");
      expect(result.slug).toBe("test-skill");
      expect(result.skill.description).toBe("Test skill");
      expect(result.skill.sourceUrl).toBe("https://example.com/skill.md");
      expect(result.warnings).toEqual([]);

      const audit = getAudit({ event: "skill_installed" });
      expect(audit).toHaveLength(1);
    });

    it("normalizes GitHub blob URLs through toRawGitHubUrl", async () => {
      fetcherMock.toRawGitHubUrl.mockImplementation((url: string) =>
        url.replace("https://github.com/", "https://raw.githubusercontent.com/").replace("/blob/", "/"),
      );
      fetcherMock.downloadUrl.mockResolvedValueOnce("---\nname: x\ndescription: y\n---\nbody");

      const result = await installSkillFromUrl("https://github.com/u/r/blob/main/SKILL.md");
      expect(fetcherMock.downloadUrl).toHaveBeenCalledWith(
        "https://raw.githubusercontent.com/u/r/main/SKILL.md",
      );
      expect(result.skill.sourceUrl).toBe("https://raw.githubusercontent.com/u/r/main/SKILL.md");
    });

    it("returns warnings for skills missing required frontmatter", async () => {
      fetcherMock.downloadUrl.mockResolvedValueOnce("# No frontmatter\n\nbody");

      const result = await installSkillFromUrl("https://example.com/bad.md");
      expect(result.warnings.length).toBeGreaterThan(0);
      // Skill is still installed (warning only, not blocking).
      expect(getSkill(result.slug)).not.toBeNull();
    });

    it("falls back to URL filename when frontmatter has no name", async () => {
      fetcherMock.downloadUrl.mockResolvedValueOnce("body");
      const result = await installSkillFromUrl(
        "https://example.com/path/git-worktree-manager.md",
      );
      expect(result.slug).toBe("git-worktree-manager");
    });

    it("rejects an empty downloaded body", async () => {
      fetcherMock.downloadUrl.mockResolvedValueOnce("   ");
      await expect(installSkillFromUrl("https://example.com/empty.md")).rejects.toThrow(
        /empty/,
      );
    });
  });

  describe("updateSkill", () => {
    it('returns "not_found" for skills not installed', async () => {
      const result = await updateSkill("nope");
      expect(result.status).toBe("not_found");
    });

    it('returns "no_source" when the skill has no sourceUrl', async () => {
      installSkill({ name: "local-only", content: "body" });
      const result = await updateSkill("local-only");
      expect(result.status).toBe("no_source");
      expect(fetcherMock.downloadUrl).not.toHaveBeenCalled();
    });

    it('returns "unchanged" when remote sha matches stored sha', async () => {
      const content = "---\nname: x\ndescription: y\n---\nbody";
      installSkill({
        name: "x",
        content,
        sourceUrl: "https://example.com/x.md",
      });
      fetcherMock.downloadUrl.mockResolvedValueOnce(content);

      const result = await updateSkill("x");
      expect(result.status).toBe("unchanged");
      expect(result.oldSha256).toBe(computeSha256(content));
      expect(result.newSha256).toBe(computeSha256(content));
    });

    it('updates and writes audit when remote sha differs', async () => {
      const oldContent = "---\nname: x\ndescription: old\n---\nold body";
      const newContent = "---\nname: x\ndescription: new\n---\nnew body";
      installSkill({
        name: "x",
        content: oldContent,
        sourceUrl: "https://example.com/x.md",
      });
      fetcherMock.downloadUrl.mockResolvedValueOnce(newContent);

      const result = await updateSkill("x");
      expect(result.status).toBe("updated");
      expect(result.oldSha256).toBe(computeSha256(oldContent));
      expect(result.newSha256).toBe(computeSha256(newContent));

      const skill = getSkill("x");
      expect(skill?.content).toBe(newContent);
      expect(skill?.description).toBe("new");

      const audit = getAudit({ event: "skill_updated" });
      expect(audit).toHaveLength(1);
    });

    it('returns "error" on download failure and does not mutate the skill', async () => {
      installSkill({
        name: "x",
        content: "v1",
        sourceUrl: "https://example.com/x.md",
      });
      fetcherMock.downloadUrl.mockRejectedValueOnce(new Error("HTTP 503"));

      const result = await updateSkill("x");
      expect(result.status).toBe("error");
      expect(result.message).toContain("HTTP 503");
      // Stored content unchanged
      expect(getSkill("x")?.content).toBe("v1");
    });

    it("rejects an empty downloaded body as error", async () => {
      installSkill({
        name: "x",
        content: "v1",
        sourceUrl: "https://example.com/x.md",
      });
      fetcherMock.downloadUrl.mockResolvedValueOnce("   ");

      const result = await updateSkill("x");
      expect(result.status).toBe("error");
      expect(getSkill("x")?.content).toBe("v1");
    });
  });

  describe("updateAllSkills", () => {
    it("walks every installed skill and returns a per-skill result", async () => {
      installSkill({
        name: "remote",
        content: "v1",
        sourceUrl: "https://example.com/r.md",
      });
      installSkill({ name: "local", content: "v1" });
      fetcherMock.downloadUrl.mockResolvedValueOnce("v1"); // unchanged for "remote"

      const results = await updateAllSkills();
      expect(results).toHaveLength(2);
      const byName = new Map(results.map((r) => [r.name, r]));
      expect(byName.get("remote")?.status).toBe("unchanged");
      expect(byName.get("local")?.status).toBe("no_source");
    });
  });

  describe("verifyAllSkills", () => {
    it("returns a per-skill result and matches the stored sha when content is intact", () => {
      installSkill({ name: "a", content: "x" });
      installSkill({ name: "b", content: "y" });
      const results = verifyAllSkills();
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.match)).toBe(true);
    });
  });

  describe("uninstallSkill", () => {
    it("removes the skill and writes an audit entry", () => {
      installSkill({ name: "doomed", content: "x" });
      const ok = uninstallSkill("doomed");
      expect(ok).toBe(true);
      expect(getSkill("doomed")).toBeNull();

      const audit = getAudit({ event: "skill_removed" });
      expect(audit).toHaveLength(1);
    });

    it("returns false when the skill was not installed (no audit entry)", () => {
      const ok = uninstallSkill("never");
      expect(ok).toBe(false);
      expect(getAudit({ event: "skill_removed" })).toHaveLength(0);
    });
  });

  describe("describeSkillStatuses", () => {
    it("flags skills without a source URL as local-only", () => {
      installSkill({ name: "local", content: "---\nname: local\ndescription: L\n---\nx" });
      const items = describeSkillStatuses();
      const item = items.find((i) => i.skill.name === "local");
      expect(item?.status).toBe("local-only");
    });

    it("flags skills with requires_env as requires-not-met", () => {
      installSkill({
        name: "needy",
        content: "---\nname: needy\ndescription: N\n---\nx",
        sourceUrl: "https://example.com/n.md",
        requiresEnv: ["NEEDED_API_KEY"],
      });
      const item = describeSkillStatuses().find((i) => i.skill.name === "needy");
      expect(item?.status).toBe("requires-not-met");
    });

    it("flags skills without YAML frontmatter as no-frontmatter", () => {
      installSkill({ name: "raw", content: "no frontmatter here" });
      const item = describeSkillStatuses().find((i) => i.skill.name === "raw");
      expect(item?.status).toBe("no-frontmatter");
    });

    it("returns up-to-date for healthy installed skills", () => {
      installSkill({
        name: "good",
        content: "---\nname: good\ndescription: G\n---\nx",
        sourceUrl: "https://example.com/g.md",
      });
      const item = describeSkillStatuses().find((i) => i.skill.name === "good");
      expect(item?.status).toBe("up-to-date");
    });

    it("scales to many skills without crashing", () => {
      for (let i = 0; i < 10; i++) {
        installSkill({
          name: `s${i}`,
          content: `---\nname: s${i}\ndescription: d${i}\n---\nx`,
          sourceUrl: `https://example.com/s${i}.md`,
        });
      }
      expect(describeSkillStatuses()).toHaveLength(10);
      expect(listSkills()).toHaveLength(10);
    });
  });
});
