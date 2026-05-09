import type { ModelInfo } from "../model/types.js";
import { cloneScheduledTask, type ScheduledTask } from "../scheduled-task/types.js";
import type { TtsProvider } from "../config.js";
import path from "node:path";
import { getRuntimePaths } from "../runtime/paths.js";
import type { Channel } from "../messenger/channel.js";
import { logger } from "../utils/logger.js";

const DEFAULT_CHANNEL: Channel = "telegram";

export interface ProjectInfo {
  id: string;
  worktree: string;
  name?: string;
}

export interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}

export interface SessionDirectoryCacheInfo {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: Array<{
    worktree: string;
    lastUpdated: number;
  }>;
}

export interface UiPreferences {
  /**
   * Whether tool-call messages such as "(Read memory.md)" or "(Edit foo.ts)"
   * should appear in chat. When false, only assistant final responses are
   * sent to Telegram. Persists across restarts.
   *
   * Defaults to true (visible) so existing behaviour is unchanged for
   * users who never set it.
   */
  showToolMessages?: boolean;

  /**
   * Per-instance override for how many recent facts get inlined into the
   * session-start system prompt. When set, replaces the value coming from
   * config.memory.inlineRecentFacts (which itself comes from
   * MEMORY_INLINE_RECENT_FACTS env var, default 20).
   *
   * Setting it to 0 disables the inline path entirely — the assistant
   * must call fact_search via MCP for any context retrieval, useful when
   * testing vector recall. `null`/undefined means "use the config default".
   */
  inlineRecentFacts?: number | null;

  /**
   * Per-instance override for TTS settings. When fields here are set,
   * they win over the corresponding env-derived `config.tts.*`. When a
   * field is undefined or null, the env default applies. This lets the
   * assistant change voice/provider/speed at runtime without restarts.
   */
  tts?: {
    provider?: TtsProvider | null;
    voice?: string | null;
    /** Speed multiplier 0.5..2.0 (1.0 = normal). Stored as-is. */
    speed?: number | null;
  };
}

export interface Settings {
  currentProject?: ProjectInfo;
  /**
   * @deprecated Single-slot session field kept ONLY for backwards
   * compatibility with installs that pre-date per-channel sessions.
   * On load it is migrated into `currentSessionByChannel.telegram` and
   * deleted from disk on the next write. New code must read/write
   * sessions through `currentSessionByChannel`.
   */
  currentSession?: SessionInfo;
  /**
   * Per-channel "currently active" sessions. Each channel keeps its own
   * cursor so opening a session in WhatsApp doesn't pull Telegram into
   * it (and vice versa). The OpenCode sessions themselves are global —
   * this map only tracks which one is active where.
   */
  currentSessionByChannel?: {
    telegram?: SessionInfo;
    whatsapp?: SessionInfo;
  };
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  ttsEnabled?: boolean;
  sessionDirectoryCache?: SessionDirectoryCacheInfo;
  scheduledTasks?: ScheduledTask[];
  uiPreferences?: UiPreferences;
}

function cloneScheduledTasks(tasks: ScheduledTask[] | undefined): ScheduledTask[] | undefined {
  return tasks?.map((task) => cloneScheduledTask(task));
}

function getSettingsFilePath(): string {
  return getRuntimePaths().settingsFilePath;
}

async function readSettingsFile(): Promise<Settings> {
  try {
    const fs = await import("fs/promises");
    const content = await fs.readFile(getSettingsFilePath(), "utf-8");
    return JSON.parse(content) as Settings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      logger.error("[SettingsManager] Error reading settings file:", error);
    }
    return {};
  }
}

let settingsWriteQueue: Promise<void> = Promise.resolve();

function writeSettingsFile(settings: Settings): Promise<void> {
  settingsWriteQueue = settingsWriteQueue
    .catch(() => {
      // Keep write queue alive after failed writes.
    })
    .then(async () => {
      try {
        const fs = await import("fs/promises");
        const settingsFilePath = getSettingsFilePath();
        await fs.mkdir(path.dirname(settingsFilePath), { recursive: true });
        await fs.writeFile(settingsFilePath, JSON.stringify(settings, null, 2));
      } catch (err) {
        logger.error("[SettingsManager] Error writing settings file:", err);
      }
    });

  return settingsWriteQueue;
}

let currentSettings: Settings = {};

export function getCurrentProject(): ProjectInfo | undefined {
  return currentSettings.currentProject;
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  currentSettings.currentProject = projectInfo;
  void writeSettingsFile(currentSettings);
}

export function clearProject(): void {
  currentSettings.currentProject = undefined;
  void writeSettingsFile(currentSettings);
}

/**
 * Read the active session for a channel. Defaults to "telegram" so older
 * call sites that never specified a channel keep behaving like before
 * (Telegram has been the only channel until V1.x). New WhatsApp code
 * MUST pass `"whatsapp"` explicitly — `grep "getCurrentSession()" src/whatsapp/`
 * should be zero after migration.
 */
export function getCurrentSession(channel: Channel = DEFAULT_CHANNEL): SessionInfo | undefined {
  return currentSettings.currentSessionByChannel?.[channel];
}

/**
 * Write the active session for a channel. The channel is REQUIRED to
 * force every call site to declare which surface owns this session,
 * preventing the easy bug of accidentally cross-pollinating channels.
 */
export function setCurrentSession(channel: Channel, sessionInfo: SessionInfo): void {
  if (!currentSettings.currentSessionByChannel) {
    currentSettings.currentSessionByChannel = {};
  }
  currentSettings.currentSessionByChannel[channel] = sessionInfo;
  void writeSettingsFile(currentSettings);
}

/**
 * Clear the active session.
 *   - With a channel: clears only that channel's cursor.
 *   - Without arguments: clears ALL channels (used by reset / project switch).
 */
export function clearSession(channel?: Channel): void {
  if (!currentSettings.currentSessionByChannel) return;
  if (channel) {
    delete currentSettings.currentSessionByChannel[channel];
  } else {
    currentSettings.currentSessionByChannel = {};
  }
  void writeSettingsFile(currentSettings);
}

export function isTtsEnabled(): boolean {
  return currentSettings.ttsEnabled === true;
}

export function setTtsEnabled(enabled: boolean): void {
  currentSettings.ttsEnabled = enabled;
  void writeSettingsFile(currentSettings);
}

export function getCurrentAgent(): string | undefined {
  return currentSettings.currentAgent;
}

export function setCurrentAgent(agentName: string): void {
  currentSettings.currentAgent = agentName;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentAgent(): void {
  currentSettings.currentAgent = undefined;
  void writeSettingsFile(currentSettings);
}

export function getCurrentModel(): ModelInfo | undefined {
  return currentSettings.currentModel;
}

export function setCurrentModel(modelInfo: ModelInfo): void {
  currentSettings.currentModel = modelInfo;
  void writeSettingsFile(currentSettings);
}

export function clearCurrentModel(): void {
  currentSettings.currentModel = undefined;
  void writeSettingsFile(currentSettings);
}

export function getPinnedMessageId(): number | undefined {
  return currentSettings.pinnedMessageId;
}

export function setPinnedMessageId(messageId: number): void {
  currentSettings.pinnedMessageId = messageId;
  void writeSettingsFile(currentSettings);
}

export function clearPinnedMessageId(): void {
  currentSettings.pinnedMessageId = undefined;
  void writeSettingsFile(currentSettings);
}

export function getSessionDirectoryCache(): SessionDirectoryCacheInfo | undefined {
  return currentSettings.sessionDirectoryCache;
}

export function setSessionDirectoryCache(cache: SessionDirectoryCacheInfo): Promise<void> {
  currentSettings.sessionDirectoryCache = cache;
  return writeSettingsFile(currentSettings);
}

export function clearSessionDirectoryCache(): void {
  currentSettings.sessionDirectoryCache = undefined;
  void writeSettingsFile(currentSettings);
}

export function getScheduledTasks(): ScheduledTask[] {
  return cloneScheduledTasks(currentSettings.scheduledTasks) ?? [];
}

export function setScheduledTasks(tasks: ScheduledTask[]): Promise<void> {
  currentSettings.scheduledTasks = cloneScheduledTasks(tasks);
  return writeSettingsFile(currentSettings);
}

const DEFAULT_UI_PREFERENCES: Required<UiPreferences> = {
  showToolMessages: true,
  // null means "no override; let config.memory.inlineRecentFacts decide".
  inlineRecentFacts: null,
  // Empty object means "no TTS overrides; use config.tts.* from .env".
  tts: {},
};

export function getUiPreferences(): Required<UiPreferences> {
  return {
    ...DEFAULT_UI_PREFERENCES,
    ...(currentSettings.uiPreferences ?? {}),
  };
}

export function setUiPreferences(prefs: Partial<UiPreferences>): Promise<void> {
  currentSettings.uiPreferences = {
    ...(currentSettings.uiPreferences ?? {}),
    ...prefs,
  };
  return writeSettingsFile(currentSettings);
}

export function __resetSettingsForTests(): void {
  currentSettings = {};
  settingsWriteQueue = Promise.resolve();
}

export async function loadSettings(): Promise<void> {
  const loadedSettings = (await readSettingsFile()) as Settings & {
    serverProcess?: unknown;
    toolMessagesIntervalSec?: unknown;
  };

  let requiresRewrite = false;

  if ("toolMessagesIntervalSec" in loadedSettings) {
    delete loadedSettings.toolMessagesIntervalSec;
    requiresRewrite = true;
  }

  if ("serverProcess" in loadedSettings) {
    delete loadedSettings.serverProcess;
    requiresRewrite = true;
  }

  currentSettings = loadedSettings;
  currentSettings.scheduledTasks = cloneScheduledTasks(loadedSettings.scheduledTasks) ?? [];

  // Migration: pre-V1.x installs only had a single `currentSession` field,
  // shared across whichever channel ran the bot. With per-channel sessions
  // we move that value into `currentSessionByChannel.telegram` (Telegram
  // was the only channel until V1.x, so the assumption is safe). The old
  // field is dropped from the on-disk file on the next write.
  if (currentSettings.currentSession && !currentSettings.currentSessionByChannel) {
    currentSettings.currentSessionByChannel = {
      telegram: currentSettings.currentSession,
    };
    delete currentSettings.currentSession;
    requiresRewrite = true;
    logger.info(
      "[SettingsManager] Migrated single-slot currentSession into " +
        "currentSessionByChannel.telegram",
    );
  } else if (currentSettings.currentSession) {
    // Both fields exist — the new one wins. Drop the legacy field so it
    // doesn't pollute future writes.
    delete currentSettings.currentSession;
    requiresRewrite = true;
  }

  if (requiresRewrite) {
    void writeSettingsFile(currentSettings);
  }
}
