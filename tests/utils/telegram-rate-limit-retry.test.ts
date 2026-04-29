import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getTelegramRetryAfterMs,
  withTelegramRateLimitRetry,
} from "../../src/utils/telegram-rate-limit-retry.js";

describe("utils/telegram-rate-limit-retry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("extracts retry delay from Telegram error parameters", () => {
    const retryAfterMs = getTelegramRetryAfterMs({
      error_code: 429,
      parameters: {
        retry_after: 3,
      },
    });

    expect(retryAfterMs).toBe(3000);
  });

  it("retries failed operations with Telegram retry_after", async () => {
    vi.useFakeTimers();

    const operation = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: Too Many Requests: retry after 1"))
      .mockResolvedValueOnce("ok");

    const promise = withTelegramRateLimitRetry(operation, { maxRetries: 2 });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toBe("ok");
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-rate-limit errors", async () => {
    const operation = vi.fn().mockRejectedValueOnce(new Error("400: Bad Request"));

    await expect(withTelegramRateLimitRetry(operation, { maxRetries: 2 })).rejects.toThrow(
      "400: Bad Request",
    );
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
