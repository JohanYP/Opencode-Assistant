import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getRuntimeMode, type RuntimeMode } from "./mode.js";

export interface RuntimePaths {
  mode: RuntimeMode;
  appHome: string;
  envFilePath: string;
  settingsFilePath: string;
  logsDirPath: string;
  runDirPath: string;
}

const APP_DIR_NAME = "opencode-assistant";
const LEGACY_APP_DIR_NAME = "opencode-telegram-bot";

function platformAppHome(dirName: string): string {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, dirName);
  }

  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", dirName);
  }

  const xdgConfigHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(xdgConfigHome, dirName);
}

function getInstalledAppHome(): string {
  return platformAppHome(APP_DIR_NAME);
}

function getLegacyInstalledAppHome(): string {
  return platformAppHome(LEGACY_APP_DIR_NAME);
}

function readHomeOverride(): string | null {
  const preferred = process.env.OPENCODE_ASSISTANT_HOME;
  if (preferred && preferred.trim().length > 0) {
    return preferred;
  }

  const legacy = process.env.OPENCODE_TELEGRAM_HOME;
  if (legacy && legacy.trim().length > 0) {
    return legacy;
  }

  return null;
}

function resolveAppHome(mode: RuntimeMode): string {
  const homeOverride = readHomeOverride();
  if (homeOverride !== null) {
    return path.resolve(homeOverride);
  }

  if (mode === "sources") {
    return process.cwd();
  }

  return getInstalledAppHome();
}

export function getRuntimePaths(): RuntimePaths {
  const mode = getRuntimeMode();
  const appHome = resolveAppHome(mode);

  return {
    mode,
    appHome,
    envFilePath: path.join(appHome, ".env"),
    settingsFilePath: path.join(appHome, "settings.json"),
    logsDirPath: path.join(appHome, "logs"),
    runDirPath: path.join(appHome, "run"),
  };
}

export interface LegacyAppHomeMigration {
  migrated: boolean;
  legacyPath: string;
  newPath: string;
  reason?: string;
}

/**
 * If a config dir from the previous app name exists and the new dir doesn't,
 * move the contents over so users updating in place keep their state.
 *
 * No-op when running in `sources` mode (the working tree is its own home),
 * when an explicit home override is set, or when the new dir already exists.
 */
export function migrateLegacyAppHome(): LegacyAppHomeMigration {
  const mode = getRuntimeMode();
  const newPath = getInstalledAppHome();
  const legacyPath = getLegacyInstalledAppHome();

  const result: LegacyAppHomeMigration = {
    migrated: false,
    legacyPath,
    newPath,
  };

  if (mode === "sources") {
    result.reason = "running from source tree";
    return result;
  }

  if (readHomeOverride() !== null) {
    result.reason = "home override env var is set";
    return result;
  }

  if (legacyPath === newPath) {
    result.reason = "legacy and new paths are equal";
    return result;
  }

  let legacyExists = false;
  try {
    legacyExists = fs.statSync(legacyPath).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  if (!legacyExists) {
    result.reason = "no legacy directory found";
    return result;
  }

  let newExists = false;
  try {
    newExists = fs.statSync(newPath).isDirectory();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  if (newExists) {
    result.reason = "new directory already exists; leaving legacy untouched";
    return result;
  }

  fs.mkdirSync(path.dirname(newPath), { recursive: true });
  fs.renameSync(legacyPath, newPath);
  result.migrated = true;
  return result;
}
