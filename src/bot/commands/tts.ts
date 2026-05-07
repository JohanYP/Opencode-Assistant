import { CommandContext, Context } from "grammy";
import { config, type TtsProvider } from "../../config.js";
import { isTtsConfigured } from "../../tts/client.js";
import { getEffectiveTtsConfig } from "../../tts/config-resolver.js";
import { listEdgeVoices } from "../../tts/edge.js";
import { STATIC_VOICES, type VoiceInfo } from "../../tts/voices.js";
import {
  getUiPreferences,
  isTtsEnabled,
  setTtsEnabled,
  setUiPreferences,
} from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

const VALID_PROVIDERS: ReadonlySet<TtsProvider> = new Set([
  "edge",
  "openai",
  "speechify",
  "google",
]);

const MAX_LIST_VOICES = 30;

async function getVoicesForProvider(
  provider: TtsProvider,
  localeFilter?: string,
): Promise<VoiceInfo[]> {
  let voices: VoiceInfo[];
  if (provider === "edge") {
    const all = await listEdgeVoices();
    voices = all.map((v) => ({
      id: v.id,
      name: v.name,
      locale: v.locale,
      gender: v.gender as VoiceInfo["gender"],
    }));
  } else {
    voices = STATIC_VOICES[provider];
  }

  if (localeFilter) {
    const lc = localeFilter.toLowerCase();
    voices = voices.filter((v) => v.locale.toLowerCase().startsWith(lc));
  }
  return voices;
}

/**
 * Probe the would-be provider config without mutating settings — used to
 * reject `/tts provider <x>` when x is missing credentials so the user
 * gets a useful error instead of silent breakage on the next reply.
 */
function providerHasCredentials(provider: TtsProvider): boolean {
  if (provider === "edge") return true;
  if (provider === "google") return Boolean(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  if (provider === "speechify") return Boolean(config.tts.speechifyApiKey);
  return Boolean(config.tts.apiUrl && config.tts.apiKey);
}

async function showStatus(ctx: CommandContext<Context>): Promise<void> {
  const eff = getEffectiveTtsConfig();
  const enabled = isTtsEnabled() ? "✓" : "✗";
  await ctx.reply(
    t("tts.status_template", {
      enabled,
      provider: eff.provider,
      provider_source: eff.source.provider,
      voice: eff.voice,
      voice_source: eff.source.voice,
      speed: String(eff.speed),
    }),
    { parse_mode: "Markdown" },
  );
}

async function handleToggle(
  ctx: CommandContext<Context>,
  enable: boolean,
): Promise<void> {
  if (enable && !isTtsConfigured()) {
    logger.info(
      "[TTS] Toggle rejected: provider not configured. Try `/tts provider edge` for a free fallback.",
    );
    await ctx.reply(t("tts.not_configured"));
    return;
  }
  setTtsEnabled(enable);
  logger.info(`[TTS] Toggle: ttsEnabled=${enable}`);
  await ctx.reply(enable ? t("tts.enabled") : t("tts.disabled"));
}

async function handleProvider(
  ctx: CommandContext<Context>,
  raw: string,
): Promise<void> {
  const provider = raw.trim().toLowerCase() as TtsProvider;
  if (!VALID_PROVIDERS.has(provider)) {
    await ctx.reply(t("tts.provider_invalid"));
    return;
  }
  if (!providerHasCredentials(provider)) {
    await ctx.reply(t("tts.provider_not_configured", { provider }));
    return;
  }
  const current = getUiPreferences().tts ?? {};
  await setUiPreferences({ tts: { ...current, provider } });
  logger.info(`[TTS] Provider override set to ${provider}`);
  await ctx.reply(t("tts.provider_changed", { provider }));
}

async function handleVoice(
  ctx: CommandContext<Context>,
  voiceId: string,
): Promise<void> {
  const eff = getEffectiveTtsConfig();
  const voices = await getVoicesForProvider(eff.provider).catch(() => []);
  const exists = voices.some((v) => v.id === voiceId);
  if (!exists && eff.provider !== "openai") {
    // openai accepts arbitrary voice ids, so we don't validate against
    // the static list there.
    await ctx.reply(t("tts.voice_unknown", { voice: voiceId, provider: eff.provider }));
    return;
  }
  const current = getUiPreferences().tts ?? {};
  await setUiPreferences({ tts: { ...current, voice: voiceId } });
  await ctx.reply(t("tts.voice_changed", { voice: voiceId }));
}

async function handleSpeed(
  ctx: CommandContext<Context>,
  raw: string,
): Promise<void> {
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < 0.5 || value > 2.0) {
    await ctx.reply(t("tts.speed_invalid"));
    return;
  }
  const current = getUiPreferences().tts ?? {};
  await setUiPreferences({ tts: { ...current, speed: value } });
  await ctx.reply(t("tts.speed_changed", { speed: value.toFixed(2) }));
}

async function handleList(
  ctx: CommandContext<Context>,
  args: string[],
): Promise<void> {
  let provider: TtsProvider;
  let localeFilter: string | undefined;
  if (args[0] && VALID_PROVIDERS.has(args[0] as TtsProvider)) {
    provider = args[0] as TtsProvider;
    localeFilter = args[1];
  } else {
    provider = getEffectiveTtsConfig().provider;
    localeFilter = args[0];
  }

  let voices: VoiceInfo[];
  try {
    voices = await getVoicesForProvider(provider, localeFilter);
  } catch (err) {
    logger.warn("[TTS] /tts list — failed to fetch voices:", err);
    await ctx.reply(t("tts.list_empty"));
    return;
  }

  if (voices.length === 0) {
    await ctx.reply(t("tts.list_empty"));
    return;
  }

  const top = voices.slice(0, MAX_LIST_VOICES);
  const lines = top.map((v) => `• \`${v.id}\` — ${v.name} (${v.locale}, ${v.gender})`);
  let body = `${t("tts.list_header", { provider })}\n${lines.join("\n")}`;
  if (voices.length > MAX_LIST_VOICES) {
    body += `\n\n${t("tts.list_more", {
      count: String(voices.length - MAX_LIST_VOICES),
      provider,
      locale: localeFilter ?? "<locale-prefix>",
    })}`;
  }
  await ctx.reply(body, { parse_mode: "Markdown" });
}

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  try {
    const arg = ctx.match?.trim() ?? "";
    if (!arg) {
      await showStatus(ctx);
      return;
    }
    const [head, ...rest] = arg.split(/\s+/);
    const sub = head.toLowerCase();

    switch (sub) {
      case "on":
      case "true":
      case "yes":
      case "1":
        await handleToggle(ctx, true);
        return;
      case "off":
      case "false":
      case "no":
      case "0":
        await handleToggle(ctx, false);
        return;
      case "provider":
        if (!rest[0]) {
          await ctx.reply(t("tts.provider_invalid"));
          return;
        }
        await handleProvider(ctx, rest[0]);
        return;
      case "voice":
        if (!rest[0]) {
          await ctx.reply(t("tts.voice_unknown", { voice: "", provider: "" }));
          return;
        }
        await handleVoice(ctx, rest.join(" "));
        return;
      case "speed":
        if (!rest[0]) {
          await ctx.reply(t("tts.speed_invalid"));
          return;
        }
        await handleSpeed(ctx, rest[0]);
        return;
      case "list":
        await handleList(ctx, rest);
        return;
      default:
        await showStatus(ctx);
        return;
    }
  } catch (error) {
    logger.error("[TTS] /tts command error:", error);
    await ctx.reply(t("tts.error"));
  }
}
