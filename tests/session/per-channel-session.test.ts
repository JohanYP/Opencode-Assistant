// Per-channel session tests. Cover the V1.x split where Telegram and
// WhatsApp each track their own "currently active" session, and the
// migration from the legacy single-slot `currentSession` field.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stub the runtime paths module BEFORE importing settings/manager so the
// settings file lives in a tmp dir we can control. Each test gets its
// own tmp file so parallel tests don't stomp on each other.
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

let tmpHome = "";

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: () => ({
    mode: "sources" as const,
    appHome: tmpHome,
    envFilePath: path.join(tmpHome, ".env"),
    settingsFilePath: path.join(tmpHome, "settings.json"),
    logsDirPath: path.join(tmpHome, "logs"),
    runDirPath: path.join(tmpHome, "run"),
  }),
}));

beforeEach(async () => {
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "session-test-"));
});

afterEach(async () => {
  if (tmpHome) {
    await fs.rm(tmpHome, { recursive: true, force: true }).catch(() => undefined);
  }
});

async function freshSettingsModule() {
  vi.resetModules();
  return await import("../../src/settings/manager.js");
}

describe("per-channel session tracking", () => {
  it("starts with no session in any channel", async () => {
    const settings = await freshSettingsModule();
    await settings.loadSettings();
    expect(settings.getCurrentSession("telegram")).toBeUndefined();
    expect(settings.getCurrentSession("whatsapp")).toBeUndefined();
  });

  it("stores telegram and whatsapp sessions independently", async () => {
    const settings = await freshSettingsModule();
    await settings.loadSettings();

    settings.setCurrentSession("telegram", { id: "t1", title: "TG one", directory: "/proj" });
    settings.setCurrentSession("whatsapp", { id: "w1", title: "WA one", directory: "/proj" });

    expect(settings.getCurrentSession("telegram")?.id).toBe("t1");
    expect(settings.getCurrentSession("whatsapp")?.id).toBe("w1");
  });

  it("default getCurrentSession() returns telegram for backward compat", async () => {
    const settings = await freshSettingsModule();
    await settings.loadSettings();

    settings.setCurrentSession("telegram", { id: "tg", title: "TG", directory: "/p" });

    expect(settings.getCurrentSession()?.id).toBe("tg");
  });

  it("clearSession with no argument wipes both channels", async () => {
    const settings = await freshSettingsModule();
    await settings.loadSettings();

    settings.setCurrentSession("telegram", { id: "t", title: "T", directory: "/p" });
    settings.setCurrentSession("whatsapp", { id: "w", title: "W", directory: "/p" });

    settings.clearSession();

    expect(settings.getCurrentSession("telegram")).toBeUndefined();
    expect(settings.getCurrentSession("whatsapp")).toBeUndefined();
  });

  it("clearSession(channel) only wipes that channel", async () => {
    const settings = await freshSettingsModule();
    await settings.loadSettings();

    settings.setCurrentSession("telegram", { id: "t", title: "T", directory: "/p" });
    settings.setCurrentSession("whatsapp", { id: "w", title: "W", directory: "/p" });

    settings.clearSession("whatsapp");

    expect(settings.getCurrentSession("telegram")?.id).toBe("t");
    expect(settings.getCurrentSession("whatsapp")).toBeUndefined();
  });
});

describe("legacy single-slot migration", () => {
  it("migrates pre-V1.x currentSession into currentSessionByChannel.telegram", async () => {
    // Seed a legacy settings.json on disk
    const legacy = {
      currentSession: { id: "legacy", title: "Old session", directory: "/proj" },
      currentProject: { id: "p", worktree: "/proj" },
    };
    await fs.writeFile(path.join(tmpHome, "settings.json"), JSON.stringify(legacy));

    const settings = await freshSettingsModule();
    await settings.loadSettings();

    expect(settings.getCurrentSession("telegram")?.id).toBe("legacy");
    expect(settings.getCurrentSession("whatsapp")).toBeUndefined();
  });

  it("drops the legacy field from disk on next write", async () => {
    const legacy = {
      currentSession: { id: "legacy", title: "Old", directory: "/proj" },
    };
    await fs.writeFile(path.join(tmpHome, "settings.json"), JSON.stringify(legacy));

    const settings = await freshSettingsModule();
    await settings.loadSettings();

    // Trigger a write by setting another session.
    settings.setCurrentSession("whatsapp", { id: "w", title: "W", directory: "/proj" });

    // Wait a tick so the async write queue flushes.
    await new Promise((resolve) => setTimeout(resolve, 50));

    const onDisk = JSON.parse(
      await fs.readFile(path.join(tmpHome, "settings.json"), "utf-8"),
    );
    expect(onDisk).not.toHaveProperty("currentSession");
    expect(onDisk.currentSessionByChannel?.telegram?.id).toBe("legacy");
    expect(onDisk.currentSessionByChannel?.whatsapp?.id).toBe("w");
  });

  it("prefers the new field over the legacy one when both exist", async () => {
    const mixed = {
      currentSession: { id: "old", title: "Old", directory: "/p" },
      currentSessionByChannel: {
        telegram: { id: "new", title: "New", directory: "/p" },
      },
    };
    await fs.writeFile(path.join(tmpHome, "settings.json"), JSON.stringify(mixed));

    const settings = await freshSettingsModule();
    await settings.loadSettings();

    expect(settings.getCurrentSession("telegram")?.id).toBe("new");
  });
});
