import { config, type TtsProvider } from "../config.js";
import { getUiPreferences } from "../settings/manager.js";
import { defaultVoiceFor } from "./voices.js";

/**
 * Effective TTS configuration after merging env-derived defaults
 * (`config.tts.*`) with the runtime override stored in `settings.json`
 * under `uiPreferences.tts`. Override fields win whenever they are
 * set; unset fields fall back to the env value.
 *
 * Source-of-truth: callers in src/tts/client.ts and the TTS senders
 * use this resolver instead of reading config.tts directly so that
 * `/tts provider edge` (or the `tts_set_settings` MCP tool) can take
 * effect immediately without requiring a container restart.
 */
export interface EffectiveTtsConfig {
  provider: TtsProvider;
  voice: string;
  speed: number;
  // Source of each major field — useful for debugging and `/tts` status.
  source: {
    provider: "env" | "override";
    voice: "env" | "override" | "default";
  };
}

export function getEffectiveTtsConfig(): EffectiveTtsConfig {
  const env = config.tts;
  const override = getUiPreferences().tts ?? {};

  const provider: TtsProvider =
    override.provider != null ? override.provider : env.provider;

  const envVoiceMatchesProvider = env.provider === provider && Boolean(env.voice);

  let voice: string;
  let voiceSource: "env" | "override" | "default";

  if (override.voice != null && override.voice !== "") {
    voice = override.voice;
    voiceSource = "override";
  } else if (envVoiceMatchesProvider) {
    voice = env.voice;
    voiceSource = "env";
  } else {
    voice = defaultVoiceFor(provider, config.bot.locale);
    voiceSource = "default";
  }

  const speed =
    typeof override.speed === "number" && Number.isFinite(override.speed)
      ? override.speed
      : 1.0;

  return {
    provider,
    voice,
    speed,
    source: {
      provider: override.provider != null ? "override" : "env",
      voice: voiceSource,
    },
  };
}
