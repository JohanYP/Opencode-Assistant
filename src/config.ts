import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

export type MessageFormatMode = "raw" | "markdown";
export type TtsProvider = "openai" | "google" | "speechify" | "edge";
export type TtsDeliveryMode = "voice" | "audio";

export interface AppConfig {
  telegram: {
    // True when both TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID are
    // present and valid. When false, the Telegram bot is not started and
    // any code path that depends on grammy must check this flag first.
    enabled: boolean;
    token: string;
    allowedUserId: number;
    proxyUrl: string;
  };
  opencode: {
    apiUrl: string;
    username: string;
    password: string;
    autoRestartEnabled: boolean;
    monitorIntervalSec: number;
    model: {
      provider: string;
      modelId: string;
    };
  };
  server: {
    logLevel: string;
  };
  bot: {
    sessionsListLimit: number;
    projectsListLimit: number;
    commandsListLimit: number;
    taskLimit: number;
    scheduledTaskExecutionTimeoutMinutes: number;
    responseStreamThrottleMs: number;
    bashToolDisplayMaxLength: number;
    locale: Locale;
    hideThinkingMessages: boolean;
    hideAssistantFooter: boolean;
    hideToolCallMessages: boolean;
    hideToolFileMessages: boolean;
    messageFormatMode: MessageFormatMode;
  };
  files: {
    maxFileSizeKb: number;
  };
  open: {
    browserRoots: string;
  };
  stt: {
    apiUrl: string;
    apiKey: string;
    model: string;
    language: string;
    notePrompt: string;
    hideRecognizedText: boolean;
  };
  tts: {
    apiUrl: string;
    apiKey: string;
    speechifyApiKey: string;
    provider: TtsProvider;
    model: string;
    voice: string;
    waitForIdle: boolean;
    deliveryMode: TtsDeliveryMode;
  };
  memory: {
    dir: string;
    injectEnabled: boolean;
    inlineRecentFacts: number;
  };
  mcp: {
    httpEnabled: boolean;
    httpPort: number;
    httpHost: string;
  };
  cron: {
    ymlSync: boolean;
    backupEnabled: boolean;
    backupSchedule: string;
  };
  embedding: {
    baseUrl: string;
    model: string;
    apiKey: string;
    enabled: boolean;
  };
  whatsapp: {
    enabled: boolean;
    allowedNumber: string;
    authDir: string;
  };
}

let cachedConfig: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (cachedConfig) return cachedConfig;

  const runtimePaths = getRuntimePaths();
  dotenv.config({ path: runtimePaths.envFilePath, quiet: true });

  function getEnvVar(key: string, required: boolean = true): string {
    const value = process.env[key];
    if (required && !value) {
      throw new Error(
        `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
      );
    }
    return value || "";
  }

  function getOptionalPositiveIntEnvVar(key: string, defaultValue: number): number {
    const value = getEnvVar(key, false);

    if (!value) {
      return defaultValue;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (Number.isNaN(parsedValue) || parsedValue <= 0) {
      return defaultValue;
    }

    return parsedValue;
  }

  function getOptionalLocaleEnvVar(key: string, defaultValue: Locale): Locale {
    const value = getEnvVar(key, false);
    return normalizeLocale(value, defaultValue);
  }

  function getOptionalBooleanEnvVar(key: string, defaultValue: boolean): boolean {
    const value = getEnvVar(key, false);

    if (!value) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();

    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }

    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }

    return defaultValue;
  }

  function getOptionalMessageFormatModeEnvVar(
    key: string,
    defaultValue: MessageFormatMode,
  ): MessageFormatMode {
    const value = getEnvVar(key, false);

    if (!value) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (normalized === "raw" || normalized === "markdown") {
      return normalized;
    }

    return defaultValue;
  }

  const VALID_TTS_PROVIDERS: TtsProvider[] = ["openai", "google", "speechify", "edge"];

  function getOptionalTtsProviderEnvVar(key: string, defaultValue: TtsProvider): TtsProvider {
    const value = getEnvVar(key, false);

    if (!value) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (VALID_TTS_PROVIDERS.includes(normalized as TtsProvider)) {
      return normalized as TtsProvider;
    }

    return defaultValue;
  }

  const VALID_TTS_DELIVERY_MODES: TtsDeliveryMode[] = ["voice", "audio"];

  function getOptionalTtsDeliveryModeEnvVar(
    key: string,
    defaultValue: TtsDeliveryMode,
  ): TtsDeliveryMode {
    const value = getEnvVar(key, false);

    if (!value) {
      return defaultValue;
    }

    const normalized = value.trim().toLowerCase();
    if (VALID_TTS_DELIVERY_MODES.includes(normalized as TtsDeliveryMode)) {
      return normalized as TtsDeliveryMode;
    }

    return defaultValue;
  }

  const provider = getOptionalTtsProviderEnvVar("TTS_PROVIDER", "openai");
  // No hard-coded defaults here — `src/tts/voices.ts::defaultVoiceFor`
  // and the runtime resolver (`config-resolver.ts`) decide the actual
  // voice based on locale and any user override. Leaving voice empty
  // when TTS_VOICE is unset lets a locale-aware default apply (e.g.
  // Spanish locale gets a Spanish voice instead of "alloy").

  // Telegram is optional now — a user can run with WhatsApp only. We treat
  // the channel as enabled iff both the token and the allowed user id are
  // present and parse cleanly. The "at least one channel" invariant is
  // enforced after the full config object is built (see below).
  const rawTelegramToken = getEnvVar("TELEGRAM_BOT_TOKEN", false).trim();
  const rawTelegramUserId = getEnvVar("TELEGRAM_ALLOWED_USER_ID", false).trim();
  const parsedTelegramUserId = rawTelegramUserId ? parseInt(rawTelegramUserId, 10) : NaN;
  const telegramEnabled =
    rawTelegramToken.length > 0 && Number.isInteger(parsedTelegramUserId) && parsedTelegramUserId > 0;

  cachedConfig = {
    telegram: {
      enabled: telegramEnabled,
      token: rawTelegramToken,
      allowedUserId: telegramEnabled ? parsedTelegramUserId : 0,
      proxyUrl: getEnvVar("TELEGRAM_PROXY_URL", false),
    },
    opencode: {
      apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://localhost:4096",
      username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
      password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
      autoRestartEnabled: getOptionalBooleanEnvVar("OPENCODE_AUTO_RESTART_ENABLED", false),
      monitorIntervalSec: getOptionalPositiveIntEnvVar("OPENCODE_MONITOR_INTERVAL_SEC", 300),
      model: {
        provider: getEnvVar("OPENCODE_MODEL_PROVIDER", true),
        modelId: getEnvVar("OPENCODE_MODEL_ID", true),
      },
    },
    server: {
      logLevel: getEnvVar("LOG_LEVEL", false) || "info",
    },
    bot: {
      sessionsListLimit: getOptionalPositiveIntEnvVar("SESSIONS_LIST_LIMIT", 10),
      projectsListLimit: getOptionalPositiveIntEnvVar("PROJECTS_LIST_LIMIT", 10),
      commandsListLimit: getOptionalPositiveIntEnvVar("COMMANDS_LIST_LIMIT", 10),
      taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
      scheduledTaskExecutionTimeoutMinutes: getOptionalPositiveIntEnvVar(
        "SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES",
        120,
      ),
      responseStreamThrottleMs: getOptionalPositiveIntEnvVar("RESPONSE_STREAM_THROTTLE_MS", 500),
      bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar("BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
      locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
      hideThinkingMessages: getOptionalBooleanEnvVar("HIDE_THINKING_MESSAGES", true),
      hideAssistantFooter: getOptionalBooleanEnvVar("HIDE_ASSISTANT_FOOTER", true),
      hideToolCallMessages: getOptionalBooleanEnvVar("HIDE_TOOL_CALL_MESSAGES", false),
      hideToolFileMessages: getOptionalBooleanEnvVar("HIDE_TOOL_FILE_MESSAGES", false),
      messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
    },
    files: {
      maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
    },
    open: {
      browserRoots: getEnvVar("OPEN_BROWSER_ROOTS", false),
    },
    stt: {
      apiUrl: getEnvVar("STT_API_URL", false),
      apiKey: getEnvVar("STT_API_KEY", false),
      model: getEnvVar("STT_MODEL", false) || "whisper-large-v3-turbo",
      language: getEnvVar("STT_LANGUAGE", false),
      notePrompt: getEnvVar("STT_NOTE_PROMPT", false),
      hideRecognizedText: getOptionalBooleanEnvVar("STT_HIDE_RECOGNIZED_TEXT", false),
    },
    tts: {
      apiUrl: getEnvVar("TTS_API_URL", false),
      apiKey: getEnvVar("TTS_API_KEY", false),
      speechifyApiKey: getEnvVar("SPEECHIFY_API_KEY", false),
      provider,
      model: getEnvVar("TTS_MODEL", false) || "gpt-4o-mini-tts",
      voice: getEnvVar("TTS_VOICE", false),
      waitForIdle: getOptionalBooleanEnvVar("TTS_WAIT_FOR_IDLE", true),
      // "voice" sends a Telegram voice note (waveform UI, requires OGG/Opus
      // — we convert MP3 with ffmpeg). "audio" sends a music-player audio
      // file with the original MP3. If conversion fails in voice mode, the
      // bot automatically falls back to audio.
      deliveryMode: getOptionalTtsDeliveryModeEnvVar("TTS_DELIVERY_MODE", "voice"),
    },
    memory: {
      dir: getEnvVar("MEMORY_DIR", false) || "./memory",
      injectEnabled: getOptionalBooleanEnvVar("MEMORY_INJECT_ENABLED", true),
      // How many of the most recent facts to inline into a fresh session's
      // system prompt. 0 disables the inline path entirely so the model is
      // forced to call fact_search (useful for testing vector recall).
      // Overridable per-instance via the /inline_facts command.
      inlineRecentFacts: (() => {
        const raw = getEnvVar("MEMORY_INLINE_RECENT_FACTS", false);
        if (!raw) return 20;
        const n = Number.parseInt(raw, 10);
        if (Number.isNaN(n) || n < 0) return 20;
        return Math.min(n, 100);
      })(),
    },
    mcp: {
      // The bot exposes its memory MCP server over HTTP on this host:port so
      // a separate OpenCode container can reach it as a remote MCP server.
      httpEnabled: getOptionalBooleanEnvVar("MCP_HTTP_ENABLED", true),
      httpPort: getOptionalPositiveIntEnvVar("MCP_HTTP_PORT", 4097),
      // Bind on 0.0.0.0 inside the container so the OpenCode container
      // (in the same compose network) can reach it. The port is not
      // forwarded to the host by default — only the docker network sees it.
      httpHost: getEnvVar("MCP_HTTP_HOST", false) || "0.0.0.0",
    },
    cron: {
      ymlSync: getOptionalBooleanEnvVar("CRON_YML_SYNC", true),
      backupEnabled: getOptionalBooleanEnvVar("CRON_BACKUP_ENABLED", true),
      backupSchedule: getEnvVar("CRON_BACKUP_SCHEDULE", false) || "0 0 * * 0",
    },
    embedding: (() => {
      const baseUrl = (getEnvVar("EMBEDDING_BASE_URL", false) || "").trim();
      return {
        baseUrl,
        model: getEnvVar("EMBEDDING_MODEL", false) || "text-embedding-3-small",
        apiKey: getEnvVar("EMBEDDING_API_KEY", false),
        enabled: baseUrl.length > 0,
      };
    })(),
    whatsapp: (() => {
      const enabled = getOptionalBooleanEnvVar("WHATSAPP_ENABLED", false);
      const rawNumber = (getEnvVar("WHATSAPP_ALLOWED_NUMBER", false) || "").trim();
      // Accept either a bare phone number (digits, optionally with leading "+")
      // or a full JID. Normalize to the JID form Baileys uses internally so
      // whitelist checks compare apples to apples.
      const digits = rawNumber.replace(/[^\d]/g, "");
      const allowedNumber = digits.length > 0 ? `${digits}@s.whatsapp.net` : "";
      return {
        enabled,
        allowedNumber,
        authDir: getEnvVar("WHATSAPP_AUTH_DIR", false) || "./data/whatsapp-auth",
      };
    })(),
  };

  // Cross-channel invariant: at least one channel must be configured. This
  // catches the case where the user disabled Telegram (left token empty)
  // and also forgot to enable WhatsApp — without this guard the bot would
  // happily start with no way for the user to talk to it.
  if (!cachedConfig.telegram.enabled && !cachedConfig.whatsapp.enabled) {
    throw new Error(
      "No messaging channel is configured. Set TELEGRAM_BOT_TOKEN + " +
        "TELEGRAM_ALLOWED_USER_ID, or WHATSAPP_ENABLED=true with " +
        "WHATSAPP_ALLOWED_NUMBER, or both. Run ./setup.sh for guided setup.",
    );
  }

  return cachedConfig;
}

export function resetConfigCache(): void {
  cachedConfig = null;
}

export const config: AppConfig = new Proxy({} as AppConfig, {
  get(_target, prop) {
    return loadConfig()[prop as keyof AppConfig];
  },
  has(_target, prop) {
    return prop in loadConfig();
  },
  ownKeys() {
    return Reflect.ownKeys(loadConfig());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(loadConfig(), prop);
  },
});
