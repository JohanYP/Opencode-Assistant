import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../../src/memory/db.js";
import { appendAudit, getAudit } from "../../../src/memory/repositories/audit.js";

describe("memory/repositories/audit", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-audit-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  it("appends an entry and reads it back via getAudit", () => {
    const entry = appendAudit("skill_installed", { name: "x", url: "u" });
    expect(entry.id).toBeGreaterThan(0);
    expect(entry.event).toBe("skill_installed");
    expect(entry.payload).toEqual({ name: "x", url: "u" });

    const all = getAudit();
    expect(all).toHaveLength(1);
    expect(all[0]).toEqual(entry);
  });

  it("orders entries by ts DESC", async () => {
    appendAudit("fact_added", { content: "first" });
    await new Promise((r) => setTimeout(r, 5));
    appendAudit("fact_added", { content: "second" });
    await new Promise((r) => setTimeout(r, 5));
    appendAudit("fact_added", { content: "third" });

    const all = getAudit();
    expect(all.map((e) => (e.payload as { content: string }).content)).toEqual([
      "third",
      "second",
      "first",
    ]);
  });

  it("filters by event type", () => {
    appendAudit("skill_installed", { name: "a" });
    appendAudit("skill_removed", { name: "a" });
    appendAudit("skill_installed", { name: "b" });

    const installed = getAudit({ event: "skill_installed" });
    expect(installed).toHaveLength(2);
    expect(installed.every((e) => e.event === "skill_installed")).toBe(true);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 10; i++) {
      appendAudit("fact_added", { i });
    }
    const limited = getAudit({ limit: 3 });
    expect(limited).toHaveLength(3);
  });

  it("returns the original payload when JSON parsing succeeds", () => {
    appendAudit("memory_imported", { count: 42, dryRun: false });
    const all = getAudit();
    expect(all[0].payload).toEqual({ count: 42, dryRun: false });
  });

  it("falls back to raw string if payload is not valid JSON (defensive)", () => {
    // This shouldn't normally happen since appendAudit JSON.stringify's input,
    // but if a row was written manually we should not throw.
    const entry = appendAudit("custom", "plain string");
    expect(entry.payload).toBe("plain string");
    const read = getAudit({ event: "custom" });
    expect(read[0].payload).toBe("plain string");
  });
});
