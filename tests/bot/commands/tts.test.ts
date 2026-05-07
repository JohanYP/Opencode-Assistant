import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { ttsCommand } from "../../../src/bot/commands/tts.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  isTtsEnabledMock: vi.fn(),
  setTtsEnabledMock: vi.fn(),
  isTtsConfiguredMock: vi.fn(),
  getUiPreferencesMock: vi.fn(),
  setUiPreferencesMock: vi.fn().mockResolvedValue(undefined),
  getEffectiveTtsConfigMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  isTtsEnabled: mocked.isTtsEnabledMock,
  setTtsEnabled: mocked.setTtsEnabledMock,
  getUiPreferences: mocked.getUiPreferencesMock,
  setUiPreferences: mocked.setUiPreferencesMock,
}));

vi.mock("../../../src/tts/client.js", () => ({
  isTtsConfigured: mocked.isTtsConfiguredMock,
}));

vi.mock("../../../src/tts/config-resolver.js", () => ({
  getEffectiveTtsConfig: mocked.getEffectiveTtsConfigMock,
}));

vi.mock("../../../src/tts/edge.js", () => ({
  listEdgeVoices: vi.fn().mockResolvedValue([]),
}));

function makeCtx(arg: string) {
  const replyMock = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    chat: { id: 42, type: "private" },
    message: { text: `/tts ${arg}`.trim() },
    match: arg,
    reply: replyMock,
  } as unknown as Context;
  return { ctx, replyMock };
}

describe("bot/commands/tts", () => {
  beforeEach(() => {
    mocked.isTtsEnabledMock.mockReset().mockReturnValue(false);
    mocked.setTtsEnabledMock.mockReset();
    mocked.isTtsConfiguredMock.mockReset().mockReturnValue(true);
    mocked.getUiPreferencesMock.mockReset().mockReturnValue({ tts: {} });
    mocked.setUiPreferencesMock.mockReset().mockResolvedValue(undefined);
    mocked.getEffectiveTtsConfigMock.mockReset().mockReturnValue({
      provider: "openai",
      voice: "alloy",
      speed: 1.0,
      source: { provider: "env", voice: "env" },
    });
  });

  it("/tts on enables audio replies globally", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(true);
    const { ctx, replyMock } = makeCtx("on");
    await ttsCommand(ctx as never);
    expect(mocked.setTtsEnabledMock).toHaveBeenCalledWith(true);
    expect(replyMock).toHaveBeenCalledWith(t("tts.enabled"));
  });

  it("/tts on does not enable when TTS is not configured", async () => {
    mocked.isTtsConfiguredMock.mockReturnValue(false);
    const { ctx, replyMock } = makeCtx("on");
    await ttsCommand(ctx as never);
    expect(mocked.setTtsEnabledMock).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith(t("tts.not_configured"));
  });

  it("/tts off disables audio replies globally", async () => {
    const { ctx, replyMock } = makeCtx("off");
    await ttsCommand(ctx as never);
    expect(mocked.setTtsEnabledMock).toHaveBeenCalledWith(false);
    expect(replyMock).toHaveBeenCalledWith(t("tts.disabled"));
  });

  it("/tts (no args) shows status without mutating", async () => {
    const { ctx, replyMock } = makeCtx("");
    await ttsCommand(ctx as never);
    expect(mocked.setTtsEnabledMock).not.toHaveBeenCalled();
    expect(mocked.setUiPreferencesMock).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalled();
    const reply = replyMock.mock.calls[0][0] as string;
    expect(reply).toContain("openai");
    expect(reply).toContain("alloy");
  });

  it("/tts speed accepts numbers in 0.5..2.0", async () => {
    const { ctx, replyMock } = makeCtx("speed 1.3");
    await ttsCommand(ctx as never);
    expect(mocked.setUiPreferencesMock).toHaveBeenCalled();
    const args = mocked.setUiPreferencesMock.mock.calls[0][0] as {
      tts: { speed: number };
    };
    expect(args.tts.speed).toBeCloseTo(1.3);
    expect(replyMock).toHaveBeenCalledWith(expect.stringContaining("1.30"));
  });

  it("/tts speed rejects out-of-range", async () => {
    const { ctx, replyMock } = makeCtx("speed 5");
    await ttsCommand(ctx as never);
    expect(mocked.setUiPreferencesMock).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith(t("tts.speed_invalid"));
  });

  it("/tts provider edge persists override", async () => {
    const { ctx } = makeCtx("provider edge");
    await ttsCommand(ctx as never);
    const args = mocked.setUiPreferencesMock.mock.calls[0][0] as {
      tts: { provider: string };
    };
    expect(args.tts.provider).toBe("edge");
  });

  it("/tts provider rejects invalid name", async () => {
    const { ctx, replyMock } = makeCtx("provider lol");
    await ttsCommand(ctx as never);
    expect(mocked.setUiPreferencesMock).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith(t("tts.provider_invalid"));
  });
});
