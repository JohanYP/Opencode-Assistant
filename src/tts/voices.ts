import type { TtsProvider } from "../config.js";

/**
 * Voice catalog metadata used by `tts_list_voices` and the `/tts list`
 * command. Edge voices are fetched from the live API (see
 * `src/tts/edge.ts`); the others are curated lists of the most-used
 * neural voices because their providers don't expose a comparable free
 * "list voices" endpoint.
 */

export interface VoiceInfo {
  id: string;
  name: string;
  locale: string;
  gender: "Male" | "Female" | "Other";
}

/** Top voices for each provider (used when full catalog is not API-fetchable). */
export const STATIC_VOICES: Record<Exclude<TtsProvider, "edge">, VoiceInfo[]> = {
  openai: [
    { id: "alloy", name: "Alloy (neutral)", locale: "en-US", gender: "Other" },
    { id: "echo", name: "Echo (male)", locale: "en-US", gender: "Male" },
    { id: "fable", name: "Fable (British male)", locale: "en-GB", gender: "Male" },
    { id: "onyx", name: "Onyx (deep male)", locale: "en-US", gender: "Male" },
    { id: "nova", name: "Nova (female)", locale: "en-US", gender: "Female" },
    { id: "shimmer", name: "Shimmer (female)", locale: "en-US", gender: "Female" },
  ],
  speechify: [
    { id: "henry", name: "Henry (male)", locale: "en-US", gender: "Male" },
    { id: "matthew", name: "Matthew (male)", locale: "en-US", gender: "Male" },
    { id: "kristy", name: "Kristy (female)", locale: "en-US", gender: "Female" },
    { id: "stacy", name: "Stacy (female)", locale: "en-US", gender: "Female" },
  ],
  google: [
    { id: "en-US-Studio-O", name: "Studio O (female, premium)", locale: "en-US", gender: "Female" },
    { id: "en-US-Studio-Q", name: "Studio Q (male, premium)", locale: "en-US", gender: "Male" },
    { id: "en-US-Neural2-F", name: "Neural2 F (female)", locale: "en-US", gender: "Female" },
    { id: "es-ES-Neural2-A", name: "Neural2 A (Spanish female)", locale: "es-ES", gender: "Female" },
    { id: "es-US-Studio-B", name: "Studio B (Latin Spanish male)", locale: "es-US", gender: "Male" },
  ],
};

/** Sensible default voice per (provider, locale) pair. Used when no voice is set. */
export function defaultVoiceFor(provider: TtsProvider, locale: string): string {
  const lc = locale.toLowerCase();
  if (provider === "edge") {
    if (lc.startsWith("es")) return "es-ES-ElviraNeural";
    if (lc.startsWith("de")) return "de-DE-KatjaNeural";
    if (lc.startsWith("fr")) return "fr-FR-DeniseNeural";
    if (lc.startsWith("ru")) return "ru-RU-SvetlanaNeural";
    if (lc.startsWith("zh")) return "zh-CN-XiaoxiaoNeural";
    return "en-US-AriaNeural";
  }
  if (provider === "google") {
    if (lc.startsWith("es")) return "es-ES-Neural2-A";
    return "en-US-Studio-O";
  }
  if (provider === "speechify") {
    return "henry";
  }
  return "alloy";
}
