import { logger } from "./logger.js";

type BackgroundHook<T> = (value: T) => void | Promise<void>;

export interface SafeBackgroundTaskOptions<T> {
  taskName: string;
  task: () => Promise<T>;
  onSuccess?: BackgroundHook<T>;
  onError?: BackgroundHook<unknown>;
}

function runHookSafely<T>(
  taskName: string,
  hookName: "onSuccess" | "onError",
  hook: BackgroundHook<T> | undefined,
  value: T,
): void {
  if (!hook) {
    return;
  }

  try {
    void Promise.resolve(hook(value)).catch((hookError) => {
      logger.error(`[safeBackgroundTask] ${taskName}: ${hookName} failed:`, hookError);
    });
  } catch (hookError) {
    logger.error(`[safeBackgroundTask] ${taskName}: ${hookName} failed:`, hookError);
  }
}

export function safeBackgroundTask<T>({
  taskName,
  task,
  onSuccess,
  onError,
}: SafeBackgroundTaskOptions<T>): void {
  const handleError = (error: unknown): void => {
    logger.error(`[safeBackgroundTask] ${taskName} failed:`, error);
    runHookSafely(taskName, "onError", onError, error);
  };

  try {
    const taskPromise = task();

    void taskPromise
      .then((result) => {
        runHookSafely(taskName, "onSuccess", onSuccess, result);
      })
      .catch((error) => {
        handleError(error);
      });
  } catch (error) {
    handleError(error);
  }
}
