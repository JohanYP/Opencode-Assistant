import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigCache } from "../../src/config.js";
import {
  __resetSettingsForTests,
  loadSettings,
  setUiPreferences,
} from "../../src/settings/manager.js";
import { getEffectiveTtsConfig } from "../../src/tts/config-resolver.js";

describe("tts/config-resolver", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tts-resolver-"));
    process.env.OPENCODE_ASSISTANT_HOME = tempDir;
    delete process.env.TTS_PROVIDER;
    delete process.env.TTS_VOICE;
    process.env.BOT_LOCALE = "en";
    resetConfigCache();
    __resetSettingsForTests();
    await loadSettings();
  });

  afterEach(() => {
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.OPENCODE_ASSISTANT_HOME;
    delete process.env.TTS_PROVIDER;
    delete process.env.TTS_VOICE;
    delete process.env.BOT_LOCALE;
    resetConfigCache();
    __resetSettingsForTests();
  });

  it("falls back to env when no override is set", async () => {
    process.env.TTS_PROVIDER = "speechify";
    process.env.TTS_VOICE = "matthew";
    resetConfigCache();

    const eff = getEffectiveTtsConfig();
    expect(eff.provider).toBe("speechify");
    expect(eff.voice).toBe("matthew");
    expect(eff.speed).toBe(1.0);
    expect(eff.source.provider).toBe("env");
    expect(eff.source.voice).toBe("env");
  });

  it("override.provider wins over env.provider", async () => {
    process.env.TTS_PROVIDER = "openai";
    process.env.TTS_VOICE = "alloy";
    resetConfigCache();
    await setUiPreferences({ tts: { provider: "edge" } });

    const eff = getEffectiveTtsConfig();
    expect(eff.provider).toBe("edge");
    expect(eff.source.provider).toBe("override");
    // env.voice "alloy" doesn't apply to provider edge, so falls to default
    expect(eff.source.voice).toBe("default");
    // English locale → en-US-AriaNeural
    expect(eff.voice).toBe("en-US-AriaNeural");
  });

  it("override.voice wins over env.voice", async () => {
    process.env.TTS_PROVIDER = "edge";
    process.env.TTS_VOICE = "en-US-AriaNeural";
    resetConfigCache();
    await setUiPreferences({ tts: { voice: "es-ES-ElviraNeural" } });

    const eff = getEffectiveTtsConfig();
    expect(eff.voice).toBe("es-ES-ElviraNeural");
    expect(eff.source.voice).toBe("override");
  });

  it("override.speed accepts custom values", async () => {
    await setUiPreferences({ tts: { speed: 1.3 } });
    const eff = getEffectiveTtsConfig();
    expect(eff.speed).toBe(1.3);
  });

  it("locale-aware default when neither override nor env provide a voice", async () => {
    process.env.TTS_PROVIDER = "edge";
    process.env.BOT_LOCALE = "es";
    delete process.env.TTS_VOICE;
    resetConfigCache();

    // Reload config to ensure the new BOT_LOCALE is observed
    const { config } = await import("../../src/config.js");
    expect(config.bot.locale).toBe("es");

    const eff = getEffectiveTtsConfig();
    expect(eff.provider).toBe("edge");
    expect(eff.voice).toBe("es-ES-ElviraNeural");
    expect(eff.source.voice).toBe("default");
  });

  it("when override.provider is null, falls back to env (treated as unset)", async () => {
    process.env.TTS_PROVIDER = "speechify";
    resetConfigCache();
    // Set then clear via null
    await setUiPreferences({ tts: { provider: "edge" } });
    await setUiPreferences({ tts: { provider: null } });

    const eff = getEffectiveTtsConfig();
    expect(eff.provider).toBe("speechify");
    expect(eff.source.provider).toBe("env");
  });

  it("ignores override.speed when not a finite number", async () => {
    await setUiPreferences({ tts: { speed: NaN } });
    const eff = getEffectiveTtsConfig();
    expect(eff.speed).toBe(1.0);
  });
});
