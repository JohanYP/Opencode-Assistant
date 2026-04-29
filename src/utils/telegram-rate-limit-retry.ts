interface RetryAttemptInfo {
  attempt: number;
  retryAfterMs: number;
  error: unknown;
}

interface TelegramRateLimitRetryOptions {
  maxRetries?: number;
  fallbackDelayMs?: number;
  onRetry?: (info: RetryAttemptInfo) => void;
}

function getErrorMessage(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  return parts.join("\n");
}

function getRetryAfterSecondsFromError(error: unknown): number | null {
  if (typeof error === "object" && error !== null) {
    const parameters = Reflect.get(error, "parameters");
    if (typeof parameters === "object" && parameters !== null) {
      const retryAfter = Reflect.get(parameters, "retry_after");
      if (typeof retryAfter === "number" && Number.isFinite(retryAfter) && retryAfter > 0) {
        return retryAfter;
      }
    }
  }

  const message = getErrorMessage(error);
  const retryMatch = message.match(/retry after\s+(\d+)/i);
  if (!retryMatch) {
    return null;
  }

  const parsedSeconds = Number.parseInt(retryMatch[1], 10);
  if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
    return null;
  }

  return parsedSeconds;
}

function isTelegramRateLimitError(error: unknown): boolean {
  if (typeof error === "object" && error !== null) {
    const status = Reflect.get(error, "status");
    if (typeof status === "number" && status === 429) {
      return true;
    }

    const errorCode = Reflect.get(error, "error_code");
    if (typeof errorCode === "number" && errorCode === 429) {
      return true;
    }
  }

  const message = getErrorMessage(error).toLowerCase();
  return /\b429\b/.test(message) || message.includes("too many requests");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function getTelegramRetryAfterMs(
  error: unknown,
  fallbackDelayMs: number = 1000,
): number | null {
  if (!isTelegramRateLimitError(error)) {
    return null;
  }

  const retryAfterSeconds = getRetryAfterSecondsFromError(error);
  if (retryAfterSeconds !== null) {
    return retryAfterSeconds * 1000;
  }

  return Math.max(1, Math.floor(fallbackDelayMs));
}

export async function withTelegramRateLimitRetry<T>(
  operation: () => Promise<T>,
  options?: TelegramRateLimitRetryOptions,
): Promise<T> {
  const maxRetries = Math.max(0, Math.floor(options?.maxRetries ?? 3));
  const fallbackDelayMs = options?.fallbackDelayMs ?? 1000;

  let attempt = 0;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      const retryAfterMs = getTelegramRetryAfterMs(error, fallbackDelayMs);
      if (retryAfterMs === null || attempt >= maxRetries) {
        throw error;
      }

      attempt += 1;
      options?.onRetry?.({
        attempt,
        retryAfterMs,
        error,
      });
      await wait(retryAfterMs);
    }
  }
}
