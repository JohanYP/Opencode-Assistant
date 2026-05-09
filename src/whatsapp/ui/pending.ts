// Tracks which JIDs have a numbered-menu reply pending. When a user replies
// with a digit, the registered callback resolves that index. If the user
// replies with anything else, the callback's `onInvalid` runs (typically
// to re-send a hint without consuming the pending state).
//
// We intentionally keep this in-memory only: pending menus are fragile by
// nature (network hiccups, user gives up, bot restarts), so persistence
// would create more confusion than it solves. A bot restart drops the
// pending state and the user can re-issue the command.

import { logger } from "../../utils/logger.js";

export interface PendingMenu {
  optionsCount: number;
  // Called when the user reply parses to a valid 1-based index. Returns
  // a promise so handlers can await async work. After this fires, the
  // pending entry is removed automatically.
  onSelect: (index: number) => Promise<void>;
  // Called when the user reply doesn't parse to a valid number in range.
  // Should usually re-send a hint. The pending entry is *kept* on invalid
  // input — the user can still answer correctly afterwards.
  onInvalid?: () => Promise<void>;
  // Called when /cancel is received or the menu is cleared explicitly.
  // The pending entry is removed before this runs.
  onCancel?: () => Promise<void>;
  // Set when the menu was registered, for debugging stale-state issues.
  createdAt: number;
}

const pendingByJid = new Map<string, PendingMenu>();

export function registerPendingMenu(jid: string, menu: Omit<PendingMenu, "createdAt">): void {
  // If there's already a pending menu for this JID, cancel it first so the
  // previous handler knows it was preempted. This matches the project's
  // single-active-interaction policy (CONCEPT.md).
  const existing = pendingByJid.get(jid);
  if (existing) {
    pendingByJid.delete(jid);
    if (existing.onCancel) {
      void existing.onCancel().catch((err) => {
        logger.warn("[WhatsApp] Pending menu onCancel threw during preempt", err);
      });
    }
  }
  pendingByJid.set(jid, { ...menu, createdAt: Date.now() });
}

export function hasPendingMenu(jid: string): boolean {
  return pendingByJid.has(jid);
}

export function getPendingMenu(jid: string): PendingMenu | null {
  return pendingByJid.get(jid) ?? null;
}

export function clearPendingMenu(jid: string): PendingMenu | null {
  const existing = pendingByJid.get(jid) ?? null;
  pendingByJid.delete(jid);
  return existing;
}

// Routes a free-text user reply to the pending menu's appropriate callback.
// Returns true if the input was consumed (valid selection or invalid retry),
// false if there was no pending menu for this JID.
export async function dispatchToPendingMenu(jid: string, text: string): Promise<boolean> {
  const menu = pendingByJid.get(jid);
  if (!menu) return false;

  // Lazy import keeps the dependency graph one-way (ui/menu doesn't pull
  // in pending, only the other way around).
  const { parseNumberedReply } = await import("./menu.js");
  const choice = parseNumberedReply(text, menu.optionsCount);

  if (choice !== null) {
    pendingByJid.delete(jid);
    try {
      await menu.onSelect(choice);
    } catch (err) {
      logger.error("[WhatsApp] Pending menu onSelect threw", err);
    }
    return true;
  }

  if (menu.onInvalid) {
    try {
      await menu.onInvalid();
    } catch (err) {
      logger.warn("[WhatsApp] Pending menu onInvalid threw", err);
    }
  }
  return true;
}

// Force-clears a pending menu. Used by /abort and similar global commands
// that should preempt any in-flight numbered selection.
export async function cancelPendingMenu(jid: string): Promise<boolean> {
  const menu = pendingByJid.get(jid);
  if (!menu) return false;
  pendingByJid.delete(jid);
  if (menu.onCancel) {
    try {
      await menu.onCancel();
    } catch (err) {
      logger.warn("[WhatsApp] Pending menu onCancel threw", err);
    }
  }
  return true;
}
