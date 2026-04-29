/**
 * Tracks which sessions have already received the full memory context injection.
 *
 * Strategy (Option B with light variant):
 * - First message of a NEW session → inject soul.md + agents.md + session-summary.md
 * - Subsequent messages in the SAME session → no injection (OpenCode handles history)
 *
 * The tracker lives in RAM only. It is cleared when the bot restarts,
 * which is correct — every new bot start means fresh context injection.
 */

const initializedSessions = new Set<string>();

/**
 * Returns true if this session has already received the full memory context.
 */
export function isSessionInitialized(sessionId: string): boolean {
  return initializedSessions.has(sessionId);
}

/**
 * Marks a session as initialized so subsequent messages skip full injection.
 */
export function markSessionInitialized(sessionId: string): void {
  initializedSessions.add(sessionId);
}

/**
 * Removes a session from the tracker (e.g. when a new session is created
 * or when memory files change and context needs to be re-injected).
 */
export function invalidateSession(sessionId: string): void {
  initializedSessions.delete(sessionId);
}

/**
 * Clears all tracked sessions. Called on bot restart via cleanupBotRuntime.
 */
export function clearSessionTracker(): void {
  initializedSessions.clear();
}

/**
 * Returns the number of currently tracked sessions (for debugging).
 */
export function getTrackedSessionCount(): number {
  return initializedSessions.size;
}
