import dotenv from "dotenv";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

export type MessageFormatMode = "raw" | "markdown";
export type TtsProvider = "openai" | "google" | "speechify";
export type TtsDeliveryMode = "voice" | "audio";

export interface AppConfig {
  telegram: {
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
  };
  cron: {
    ymlSync: boolean;
    backupEnabled: boolean;
    backupSchedule: string;
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

  const VALID_TTS_PROVIDERS: TtsProvider[] = ["openai", "google", "speechify"];

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
  const defaultVoice =
    provider === "google" ? "en-US-Studio-O" : provider === "speechify" ? "henry" : "alloy";

  cachedConfig = {
    telegram: {
      token: getEnvVar("TELEGRAM_BOT_TOKEN"),
      allowedUserId: parseInt(getEnvVar("TELEGRAM_ALLOWED_USER_ID"), 10),
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
      voice: getEnvVar("TTS_VOICE", false) || defaultVoice,
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
    },
    cron: {
      ymlSync: getOptionalBooleanEnvVar("CRON_YML_SYNC", true),
      backupEnabled: getOptionalBooleanEnvVar("CRON_BACKUP_ENABLED", true),
      backupSchedule: getEnvVar("CRON_BACKUP_SCHEDULE", false) || "0 0 * * 0",
    },
  };

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
