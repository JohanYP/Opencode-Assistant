import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";
import { getRuntimePaths, migrateLegacyAppHome } from "../../src/runtime/paths.js";

function setPlatform(platform: NodeJS.Platform): () => void {
  const originalPlatform = process.platform;
  Object.defineProperty(process, "platform", { value: platform, configurable: true });

  return () => {
    Object.defineProperty(process, "platform", { value: originalPlatform, configurable: true });
  };
}

describe("runtime/paths", () => {
  beforeEach(() => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    delete process.env.OPENCODE_ASSISTANT_HOME;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
    setRuntimeMode("sources");
  });

  afterEach(() => {
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
    vi.unstubAllEnvs();
  });

  it("uses process cwd in sources mode", () => {
    setRuntimeMode("sources");

    const runtimePaths = getRuntimePaths();

    expect(runtimePaths.mode).toBe("sources");
    expect(runtimePaths.appHome).toBe(process.cwd());
    expect(runtimePaths.envFilePath).toBe(path.join(process.cwd(), ".env"));
    expect(runtimePaths.settingsFilePath).toBe(path.join(process.cwd(), "settings.json"));
    expect(runtimePaths.logsDirPath).toBe(path.join(process.cwd(), "logs"));
  });

  it("uses OPENCODE_ASSISTANT_HOME when override is set", () => {
    const customHome = path.join(process.cwd(), ".tmp", "runtime-home");
    setRuntimeMode("installed");
    vi.stubEnv("OPENCODE_ASSISTANT_HOME", customHome);

    const runtimePaths = getRuntimePaths();

    expect(runtimePaths.mode).toBe("installed");
    expect(runtimePaths.appHome).toBe(path.resolve(customHome));
    expect(runtimePaths.runDirPath).toBe(path.join(path.resolve(customHome), "run"));
  });

  it("falls back to legacy OPENCODE_TELEGRAM_HOME when only the legacy var is set", () => {
    const customHome = path.join(process.cwd(), ".tmp", "runtime-home-legacy");
    setRuntimeMode("installed");
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", customHome);

    const runtimePaths = getRuntimePaths();

    expect(runtimePaths.appHome).toBe(path.resolve(customHome));
  });

  it("resolves windows installed home via APPDATA", () => {
    const restorePlatform = setPlatform("win32");
    vi.stubEnv("APPDATA", "C:\\Users\\test\\AppData\\Roaming");
    setRuntimeMode("installed");

    try {
      const runtimePaths = getRuntimePaths();

      expect(runtimePaths.mode).toBe("installed");
      expect(runtimePaths.appHome).toBe(
        path.join("C:\\Users\\test\\AppData\\Roaming", "opencode-assistant"),
      );
      expect(runtimePaths.logsDirPath).toBe(path.join(runtimePaths.appHome, "logs"));
    } finally {
      restorePlatform();
    }
  });
});

describe("runtime/paths migrateLegacyAppHome", () => {
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "oc-asst-paths-"));
    delete process.env.OPENCODE_TELEGRAM_HOME;
    delete process.env.OPENCODE_ASSISTANT_HOME;
    delete process.env.APPDATA;
    delete process.env.XDG_CONFIG_HOME;
    setRuntimeMode("installed");
  });

  afterEach(() => {
    delete process.env.OPENCODE_TELEGRAM_RUNTIME_MODE;
    vi.unstubAllEnvs();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  it("renames the legacy directory when only the legacy dir exists", () => {
    const restorePlatform = setPlatform("linux");
    try {
      vi.stubEnv("XDG_CONFIG_HOME", tempRoot);
      const legacyDir = path.join(tempRoot, "opencode-telegram-bot");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.writeFileSync(path.join(legacyDir, "settings.json"), '{"foo":1}', "utf-8");

      const result = migrateLegacyAppHome();

      expect(result.migrated).toBe(true);
      const newDir = path.join(tempRoot, "opencode-assistant");
      expect(fs.existsSync(newDir)).toBe(true);
      expect(fs.readFileSync(path.join(newDir, "settings.json"), "utf-8")).toBe('{"foo":1}');
      expect(fs.existsSync(legacyDir)).toBe(false);
    } finally {
      restorePlatform();
    }
  });

  it("is a no-op when the new directory already exists", () => {
    const restorePlatform = setPlatform("linux");
    try {
      vi.stubEnv("XDG_CONFIG_HOME", tempRoot);
      const legacyDir = path.join(tempRoot, "opencode-telegram-bot");
      const newDir = path.join(tempRoot, "opencode-assistant");
      fs.mkdirSync(legacyDir, { recursive: true });
      fs.mkdirSync(newDir, { recursive: true });

      const result = migrateLegacyAppHome();

      expect(result.migrated).toBe(false);
      expect(fs.existsSync(legacyDir)).toBe(true);
      expect(fs.existsSync(newDir)).toBe(true);
    } finally {
      restorePlatform();
    }
  });

  it("is a no-op when no legacy directory exists", () => {
    const restorePlatform = setPlatform("linux");
    try {
      vi.stubEnv("XDG_CONFIG_HOME", tempRoot);

      const result = migrateLegacyAppHome();

      expect(result.migrated).toBe(false);
      expect(result.reason).toBeDefined();
    } finally {
      restorePlatform();
    }
  });

  it("is a no-op in sources mode", () => {
    setRuntimeMode("sources");

    const result = migrateLegacyAppHome();

    expect(result.migrated).toBe(false);
  });

  it("is a no-op when home override env var is set", () => {
    const restorePlatform = setPlatform("linux");
    try {
      vi.stubEnv("XDG_CONFIG_HOME", tempRoot);
      const legacyDir = path.join(tempRoot, "opencode-telegram-bot");
      fs.mkdirSync(legacyDir, { recursive: true });
      vi.stubEnv("OPENCODE_ASSISTANT_HOME", path.join(tempRoot, "custom"));

      const result = migrateLegacyAppHome();

      expect(result.migrated).toBe(false);
      expect(fs.existsSync(legacyDir)).toBe(true);
    } finally {
      restorePlatform();
    }
  });
});
