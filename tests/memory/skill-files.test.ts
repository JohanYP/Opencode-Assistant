import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  InvalidSkillNameError,
  assertValidSkillName,
  getSkillFilePath,
  removeSkillFile,
  writeSkillFile,
} from "../../src/memory/skill-files.js";

describe("memory/skill-files", () => {
  describe("assertValidSkillName", () => {
    it("accepts slug-style names", () => {
      for (const name of ["foo", "foo-bar", "foo_bar", "abc123", "a", "a-b-c", "x_y_z"]) {
        expect(() => assertValidSkillName(name)).not.toThrow();
      }
    });

    it("rejects names that escape the directory or aren't slugs", () => {
      for (const bad of [
        "../escape",
        "foo/bar",
        "foo\\bar",
        "Foo",
        "FOO",
        "foo bar",
        "foo.md",
        "-leading-dash",
        "trailing-",
        "_leading",
        "trailing_",
        "",
        "a".repeat(65),
      ]) {
        expect(() => assertValidSkillName(bad)).toThrow(InvalidSkillNameError);
      }
    });
  });

  describe("write/remove on the filesystem", () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-files-test-"));
      process.env.MEMORY_DIR = tempDir;
    });

    afterEach(() => {
      if (tempDir && fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
      delete process.env.MEMORY_DIR;
    });

    it("writeSkillFile creates the skills directory and the file", async () => {
      await writeSkillFile("hello-world", "# Hello\n\nbody");
      const filePath = getSkillFilePath("hello-world");
      expect(filePath).toBe(path.join(tempDir, "skills", "hello-world.md"));
      expect(fs.readFileSync(filePath, "utf-8")).toBe("# Hello\n\nbody");
    });

    it("writeSkillFile overwrites an existing file", async () => {
      await writeSkillFile("again", "v1");
      await writeSkillFile("again", "v2");
      expect(fs.readFileSync(getSkillFilePath("again"), "utf-8")).toBe("v2");
    });

    it("removeSkillFile deletes the file and tolerates missing files", async () => {
      await writeSkillFile("byebye", "x");
      const filePath = getSkillFilePath("byebye");
      expect(fs.existsSync(filePath)).toBe(true);

      await removeSkillFile("byebye");
      expect(fs.existsSync(filePath)).toBe(false);

      // second call (file already gone) should not throw
      await expect(removeSkillFile("byebye")).resolves.toBeUndefined();
    });
  });
});
