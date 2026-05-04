import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

const DB_FILENAME = "data.db";
const LATEST_SCHEMA_VERSION = 1;

let dbInstance: Database.Database | null = null;

export function getDbPath(): string {
  const memoryDir = process.env.MEMORY_DIR ?? "./memory";
  return path.resolve(memoryDir, DB_FILENAME);
}

export function getDb(): Database.Database {
  if (dbInstance) {
    return dbInstance;
  }

  const dbPath = getDbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  // WAL allows concurrent readers + a single writer without blocking.
  // The bot writes on user input; the MCP server writes on OpenCode tool calls.
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Wait up to 5 seconds for a competing writer before giving up.
  db.pragma("busy_timeout = 5000");

  runMigrations(db);
  dbInstance = db;
  return dbInstance;
}

export function closeDb(): void {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch (error) {
      logger.warn("[Memory/DB] Error closing database:", error);
    }
    dbInstance = null;
  }
}

/**
 * Test-only helper: drop the cached instance so the next getDb() reopens.
 * Does not delete the underlying file.
 */
export function resetDbInstance(): void {
  closeDb();
}

function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const row = db
    .prepare("SELECT MAX(version) as v FROM schema_version")
    .get() as { v: number | null };
  const currentVersion = row.v ?? 0;

  if (currentVersion >= LATEST_SCHEMA_VERSION) {
    return;
  }

  if (currentVersion < 1) {
    applyMigration(db, 1, migration1);
  }
}

function applyMigration(
  db: Database.Database,
  version: number,
  fn: (db: Database.Database) => void,
): void {
  const tx = db.transaction(() => {
    fn(db);
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (?, ?)").run(
      version,
      new Date().toISOString(),
    );
  });
  tx();
  logger.info(`[Memory/DB] Applied schema migration v${version}`);
}

function migration1(db: Database.Database): void {
  db.exec(`
    -- Atomic facts: imported from memory.md or created live by OpenCode tools.
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      content TEXT NOT NULL,
      source TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      embedding BLOB
    );
    CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
    CREATE INDEX IF NOT EXISTS idx_facts_updated_at ON facts(updated_at DESC);

    -- Long-form documents: soul, agents, context, session-summary.
    -- 'soul' and 'agents' are intended as read-only identity; 'context' and
    -- 'session-summary' are read/write by OpenCode through MCP tools.
    CREATE TABLE IF NOT EXISTS documents (
      name TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Skills registry: SKILL.md files imported from URLs or local fs.
    CREATE TABLE IF NOT EXISTS skills (
      name TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      description TEXT,
      category TEXT,
      version TEXT,
      source_url TEXT,
      sha256 TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      requires_env TEXT,
      requires_bins TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);

    -- Append-only audit log of memory mutations.
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      event TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_ts ON audit_log(ts DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_event ON audit_log(event);

    -- Scheduled tasks: future replacement for cron.yml as the source of truth.
    -- Phase 1.3 migration imports cron.yml entries here on first run.
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      schedule TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks(next_run_at);
  `);
}
