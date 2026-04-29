/**
 * Per-session task queue.
 *
 * Tasks enqueued for the same session id run strictly sequentially —
 * each one waits for the previous to settle (success OR failure) before
 * starting. Tasks for different sessions run independently.
 *
 * This is used to keep ordering guarantees between events that arrive on
 * the OpenCode SSE stream (onComplete, onSessionIdle, ...) and the work
 * they trigger (text delivery, TTS synthesis + send, etc.). Without it,
 * a slow operation (such as TTS synthesis + sendVoice) for turn N could
 * still be in flight while turn N+1's text is already being delivered,
 * causing the audio to arrive out of order in the chat.
 *
 * Failures in one task do NOT prevent the next from running — `.catch`
 * absorbs the rejection so the chain stays alive.
 */

const sessionCompletionTasks = new Map<string, Promise<void>>();

export function enqueueSessionCompletionTask(
  sessionId: string,
  task: () => Promise<void>,
): Promise<void> {
  const previousTask = sessionCompletionTasks.get(sessionId) ?? Promise.resolve();
  const nextTask = previousTask
    .catch(() => undefined)
    .then(task)
    .finally(() => {
      // Only clear the map slot if we are still the most-recent task; a
      // newer enqueue may have already replaced us.
      if (sessionCompletionTasks.get(sessionId) === nextTask) {
        sessionCompletionTasks.delete(sessionId);
      }
    });

  sessionCompletionTasks.set(sessionId, nextTask);
  return nextTask;
}

export function getSessionCompletionTask(sessionId: string): Promise<void> | undefined {
  return sessionCompletionTasks.get(sessionId);
}

export function clearSessionCompletionTasks(): void {
  sessionCompletionTasks.clear();
}
