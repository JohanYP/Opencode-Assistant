#!/usr/bin/env node
/**
 * MCP server entrypoint. Started by OpenCode (configured via mcp.json) on
 * an as-needed basis. Talks JSON-RPC over stdio.
 *
 * Compiled output: dist/mcp/main.js
 */
import { initializeLogger, logger } from "../utils/logger.js";
import { closeDb } from "../memory/db.js";
import { startMemoryMcpServer } from "./memory-server.js";

async function main(): Promise<void> {
  await initializeLogger();
  const handle = await startMemoryMcpServer();

  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info(`[MCP/Memory] Received ${signal}, shutting down`);
    handle.close();
    closeDb();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // OpenCode closes stdin when it stops; treat that as shutdown.
  process.stdin.on("end", () => {
    logger.info("[MCP/Memory] stdin closed; shutting down");
    handle.close();
    closeDb();
    process.exit(0);
  });
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`[MCP/Memory] Fatal: ${message}\n`);
  process.exit(1);
});
