import {
  getCurrentSession as getSettingsSession,
  setCurrentSession as setSettingsSession,
  clearSession as clearSettingsSession,
  SessionInfo,
} from "../settings/manager.js";
import type { Channel } from "../messenger/channel.js";

export type { SessionInfo };

/**
 * Set the active session for a specific channel. Both arguments are
 * required so call sites are forced to declare which surface owns the
 * session — that's what keeps Telegram and WhatsApp from accidentally
 * stomping on each other.
 */
export function setCurrentSession(channel: Channel, sessionInfo: SessionInfo): void {
  setSettingsSession(channel, sessionInfo);
}

/**
 * Get the active session for a channel. Defaults to "telegram" when no
 * channel is provided so legacy call sites in src/bot/* keep their
 * historical semantics. WhatsApp call sites must pass `"whatsapp"`.
 */
export function getCurrentSession(channel: Channel = "telegram"): SessionInfo | null {
  return getSettingsSession(channel) ?? null;
}

/**
 * Clear the active session for a channel. Pass no argument to clear ALL
 * channels (used by global resets like project switch).
 */
export function clearSession(channel?: Channel): void {
  clearSettingsSession(channel);
}
