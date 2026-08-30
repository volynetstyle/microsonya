import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isRetryableTelegramError,
  launchWithRetry,
} from "../apps/telegram/bot/src/launchWithRetry.js";

describe("launchWithRetry", () => {
  afterEach(() => vi.useRealTimers());

  it("retries transient launch failures with capped exponential backoff", async () => {
    vi.useFakeTimers();
    const launch = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("timeout"))
      .mockRejectedValueOnce(new Error("timeout"))
      .mockResolvedValueOnce();
    const onRetry = vi.fn();

    const result = launchWithRetry(launch, {
      signal: new AbortController().signal,
      initialDelayMs: 10,
      maxDelayMs: 15,
      onRetry,
    });

    await vi.advanceTimersByTimeAsync(25);
    await result;

    expect(launch).toHaveBeenCalledTimes(3);
    expect(onRetry.mock.calls.map((call) => call[1])).toEqual([10, 15]);
  });

  it("stops waiting and does not retry after cancellation", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const launch = vi.fn<() => Promise<void>>().mockRejectedValue(new Error());
    const result = launchWithRetry(launch, {
      signal: controller.signal,
      initialDelayMs: 10_000,
    });

    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    await result;
    await vi.advanceTimersByTimeAsync(20_000);

    expect(launch).toHaveBeenCalledTimes(1);
  });

  it("fails immediately when the error is not retryable", async () => {
    const conflict = Object.assign(new Error("polling conflict"), {
      response: { error_code: 409 },
    });
    const launch = vi.fn<() => Promise<void>>().mockRejectedValue(conflict);
    const onRetry = vi.fn();

    await expect(
      launchWithRetry(launch, {
        signal: new AbortController().signal,
        shouldRetry: (error) =>
          (error as typeof conflict).response.error_code !== 409,
        onRetry,
      }),
    ).rejects.toBe(conflict);

    expect(launch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe("isRetryableTelegramError", () => {
  it("retries transient network, rate-limit, and server failures", () => {
    expect(isRetryableTelegramError(new Error("ETIMEDOUT"))).toBe(true);
    expect(isRetryableTelegramError({ response: { error_code: 429 } })).toBe(
      true,
    );
    expect(isRetryableTelegramError({ response: { error_code: 503 } })).toBe(
      true,
    );
  });

  it("does not retry permanent Telegram client errors", () => {
    expect(isRetryableTelegramError({ response: { error_code: 409 } })).toBe(
      false,
    );
    expect(isRetryableTelegramError({ response: { error_code: 401 } })).toBe(
      false,
    );
  });
});
