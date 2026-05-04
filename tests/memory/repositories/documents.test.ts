import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, resetDbInstance } from "../../../src/memory/db.js";
import {
  deleteDocument,
  getDocument,
  listDocuments,
  setDocument,
} from "../../../src/memory/repositories/documents.js";

describe("memory/repositories/documents", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-docs-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
    delete process.env.MEMORY_DIR;
  });

  it("returns null for a missing document", () => {
    expect(getDocument("soul")).toBeNull();
  });

  it("inserts a document and reads it back", () => {
    const doc = setDocument("soul", "I am the assistant.");
    expect(doc.name).toBe("soul");
    expect(doc.content).toBe("I am the assistant.");

    const read = getDocument("soul");
    expect(read?.content).toBe("I am the assistant.");
  });

  it("updates an existing document on second write (upsert)", () => {
    setDocument("context", "first version");
    const updated = setDocument("context", "second version");
    expect(updated.content).toBe("second version");
    const read = getDocument("context");
    expect(read?.content).toBe("second version");
  });

  it("bumps updated_at on overwrite", async () => {
    const first = setDocument("session-summary", "old");
    await new Promise((r) => setTimeout(r, 5));
    const second = setDocument("session-summary", "new");
    expect(second.updatedAt > first.updatedAt).toBe(true);
  });

  it("lists documents alphabetically by name", () => {
    setDocument("session-summary", "z");
    setDocument("agents", "a");
    setDocument("context", "c");
    setDocument("soul", "s");

    const names = listDocuments().map((d) => d.name);
    expect(names).toEqual(["agents", "context", "session-summary", "soul"]);
  });

  it("deletes a document", () => {
    setDocument("agents", "guidance");
    expect(deleteDocument("agents")).toBe(true);
    expect(getDocument("agents")).toBeNull();
    expect(deleteDocument("agents")).toBe(false);
  });
});
