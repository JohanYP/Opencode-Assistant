import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "../../src/config.js";
import { closeDb, getDb, resetDbInstance } from "../../src/memory/db.js";
import { buildMemoryContext } from "../../src/memory/injector.js";
import { addFact } from "../../src/memory/repositories/facts.js";
import {
  __resetSettingsForTests,
  loadSettings,
  setUiPreferences,
} from "../../src/settings/manager.js";

describe("memory/injector inlineRecentFacts", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "injector-test-"));
    process.env.MEMORY_DIR = tempDir;
    process.env.OPENCODE_ASSISTANT_HOME = tempDir;
    delete process.env.MEMORY_INLINE_RECENT_FACTS;
    resetDbInstance();
    resetConfigCache();
    __resetSettingsForTests();
    getDb();
    await loadSettings();
  });

  afterEach(() => {
    closeDb();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.MEMORY_DIR;
    delete process.env.OPENCODE_ASSISTANT_HOME;
    delete process.env.MEMORY_INLINE_RECENT_FACTS;
    resetConfigCache();
    __resetSettingsForTests();
  });

  it("inlines facts by default (env default = 20)", async () => {
    addFact({ content: "I prefer light blue" });
    const ctx = await buildMemoryContext();
    expect(ctx).toContain("known_facts_about_user");
    expect(ctx).toContain("I prefer light blue");
  });

  it("omits the facts block entirely when /inline_facts is off (limit = 0)", async () => {
    addFact({ content: "I prefer light blue" });
    await setUiPreferences({ inlineRecentFacts: 0 });

    const ctx = await buildMemoryContext();
    expect(ctx).not.toContain("known_facts_about_user");
    expect(ctx).not.toContain("I prefer light blue");
  });

  it("respects MEMORY_INLINE_RECENT_FACTS env var", async () => {
    for (let i = 0; i < 5; i++) {
      addFact({ content: `fact-${i}` });
    }
    process.env.MEMORY_INLINE_RECENT_FACTS = "2";
    resetConfigCache();

    const ctx = await buildMemoryContext();
    expect(ctx).toContain("known_facts_about_user");
    // Only the 2 most recent should appear
    expect(ctx).toContain("fact-4");
    expect(ctx).toContain("fact-3");
    expect(ctx).not.toContain("fact-2");
  });

  it("user override beats env default", async () => {
    for (let i = 0; i < 3; i++) {
      addFact({ content: `fact-${i}` });
    }
    process.env.MEMORY_INLINE_RECENT_FACTS = "10";
    resetConfigCache();
    await setUiPreferences({ inlineRecentFacts: 1 });

    const ctx = await buildMemoryContext();
    expect(ctx).toContain("fact-2");
    expect(ctx).not.toContain("fact-1");
    expect(ctx).not.toContain("fact-0");
  });

  it("setting override back to null restores env default", async () => {
    addFact({ content: "I prefer light blue" });

    await setUiPreferences({ inlineRecentFacts: 0 });
    let ctx = await buildMemoryContext();
    expect(ctx).not.toContain("I prefer light blue");

    await setUiPreferences({ inlineRecentFacts: null });
    ctx = await buildMemoryContext();
    expect(ctx).toContain("I prefer light blue");
  });
});
