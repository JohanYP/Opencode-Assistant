import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getDbPath, resetDbInstance } from "../../src/memory/db.js";

describe("memory/db", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-db-test-"));
    process.env.MEMORY_DIR = tempDir;
    resetDbInstance();
  });

  afterEach(() => {
    closeDb();
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.MEMORY_DIR;
  });

  it("creates the DB file at MEMORY_DIR/data.db", () => {
    getDb();
    expect(fs.existsSync(getDbPath())).toBe(true);
    expect(getDbPath()).toBe(path.resolve(tempDir, "data.db"));
  });

  it("creates the parent MEMORY_DIR if missing", () => {
    const nested = path.join(tempDir, "nested", "memory");
    process.env.MEMORY_DIR = nested;
    resetDbInstance();
    getDb();
    expect(fs.existsSync(nested)).toBe(true);
    expect(fs.existsSync(path.join(nested, "data.db"))).toBe(true);
  });

  it("enables WAL mode", () => {
    const db = getDb();
    const mode = db.pragma("journal_mode", { simple: true });
    expect(mode).toBe("wal");
  });

  it("enables foreign keys", () => {
    const db = getDb();
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("creates all expected tables on first run", () => {
    const db = getDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain("facts");
    expect(names).toContain("documents");
    expect(names).toContain("skills");
    expect(names).toContain("audit_log");
    expect(names).toContain("scheduled_tasks");
    expect(names).toContain("schema_version");
  });

  it("records the schema version after migration", () => {
    const db = getDb();
    const row = db.prepare("SELECT MAX(version) as v FROM schema_version").get() as {
      v: number;
    };
    expect(row.v).toBeGreaterThanOrEqual(1);
  });

  it("returns the same DB instance on repeated calls", () => {
    const db1 = getDb();
    const db2 = getDb();
    expect(db1).toBe(db2);
  });

  it("does not re-apply migrations on a second open", () => {
    getDb();
    closeDb();

    const db = getDb();
    const versions = db
      .prepare("SELECT version FROM schema_version ORDER BY version")
      .all() as { version: number }[];
    expect(versions).toHaveLength(1);
    expect(versions[0].version).toBe(1);
  });

  it("supports atomic transactions", () => {
    const db = getDb();
    const insertFact = db.prepare(
      "INSERT INTO facts (category, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );

    const tx = db.transaction(() => {
      insertFact.run("test", "fact 1", "user", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
      insertFact.run("test", "fact 2", "user", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
    });
    tx();

    const count = db.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number };
    expect(count.c).toBe(2);
  });

  it("rolls back the transaction when the callback throws", () => {
    const db = getDb();
    const insertFact = db.prepare(
      "INSERT INTO facts (category, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    );

    const tx = db.transaction(() => {
      insertFact.run("test", "fact 1", "user", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");
      throw new Error("rollback expected");
    });

    expect(() => tx()).toThrow("rollback expected");

    const count = db.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number };
    expect(count.c).toBe(0);
  });

  it("closeDb followed by getDb reopens the same file", () => {
    const db1 = getDb();
    db1
      .prepare(
        "INSERT INTO facts (category, content, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("persist", "across-reopen", "user", "2026-01-01T00:00:00Z", "2026-01-01T00:00:00Z");

    closeDb();

    const db2 = getDb();
    const count = db2.prepare("SELECT COUNT(*) as c FROM facts").get() as { c: number };
    expect(count.c).toBe(1);
  });
});
