import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  sendBotTextMock: vi.fn(),
  // Mutable shape so tests can flip the flag without re-mocking the module.
  hideExternalUserInput: false,
}));

vi.mock("../../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: mocked.sendBotTextMock,
}));

// We mock the WHOLE config module because external-user-input.ts pulls
// it in for `bot.hideExternalUserInput`, and the import graph then drags
// in `opencode/client.ts` and friends which need other fields (apiUrl,
// password, etc.). The mock provides a minimal shape that satisfies
// every transitive read; tests flip `mocked.hideExternalUserInput`
// to exercise both code paths of the gate we just added.
vi.mock("../../../src/config.js", () => ({
  config: {
    bot: {
      get hideExternalUserInput() {
        return mocked.hideExternalUserInput;
      },
      locale: "en",
      messageFormatMode: "raw",
      hideThinkingMessages: true,
      hideAssistantFooter: true,
      hideToolCallMessages: false,
      hideToolFileMessages: false,
    },
    opencode: {
      apiUrl: "http://localhost:4096",
      username: "opencode",
      password: "",
    },
  },
}));

import {
  buildExternalUserInputNotification,
  deliverExternalUserInputNotification,
} from "../../../src/bot/utils/external-user-input.js";

describe("bot/utils/external-user-input", () => {
  beforeEach(() => {
    mocked.sendBotTextMock.mockReset();
    mocked.sendBotTextMock.mockResolvedValue(undefined);
    // Default each test to "mirror enabled" so the existing semantics
    // are exercised. The hide-by-default test flips this back to true.
    mocked.hideExternalUserInput = false;
  });

  it("builds a quoted notification with fallback text", () => {
    const notification = buildExternalUserInputNotification("Line 1\nLine 2");

    expect(notification).toEqual({
      text: expect.stringContaining("External user input"),
      rawFallbackText: "👤 External user input\n\n> Line 1\n> Line 2",
    });
  });

  it("sends external user input when session matches and it is not suppressed", async () => {
    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(true);
    expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 777,
        format: "markdown_v2",
        rawFallbackText: "👤 External user input\n\n> Review the parser",
      }),
    );
  });

  it("does not send notification when input is suppressed", async () => {
    const consumeSuppressedInput = vi.fn().mockReturnValue(true);

    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput,
    });

    expect(delivered).toBe(false);
    expect(consumeSuppressedInput).toHaveBeenCalledWith("session-1", "Review the parser");
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });

  it("does not send notification when the current session differs", async () => {
    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-2",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput: vi.fn().mockReturnValue(false),
    });

    expect(delivered).toBe(false);
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
  });

  it("suppresses delivery entirely when HIDE_EXTERNAL_USER_INPUT is on", async () => {
    mocked.hideExternalUserInput = true;
    const consumeSuppressedInput = vi.fn().mockReturnValue(false);

    const delivered = await deliverExternalUserInputNotification({
      api: { sendMessage: vi.fn() } as never,
      chatId: 777,
      currentSessionId: "session-1",
      sessionId: "session-1",
      text: "Review the parser",
      consumeSuppressedInput,
    });

    expect(delivered).toBe(false);
    expect(mocked.sendBotTextMock).not.toHaveBeenCalled();
    // Suppression entry is still consumed so the dedup window doesn't drift.
    expect(consumeSuppressedInput).toHaveBeenCalledWith("session-1", "Review the parser");
  });
});
