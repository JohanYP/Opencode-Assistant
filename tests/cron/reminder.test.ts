import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearReminderTargets,
  registerReminderTarget,
  sendReminder,
} from "../../src/cron/reminder.js";

vi.mock("../../src/memory/manager.js", () => ({
  backupMemory: vi.fn(async () => "/tmp/fake-backup"),
}));

vi.mock("../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: vi.fn(async () => undefined),
}));

import { sendBotText } from "../../src/bot/utils/telegram-text.js";

describe("reminder targets registry", () => {
  beforeEach(() => {
    clearReminderTargets();
    vi.clearAllMocks();
  });

  afterEach(() => {
    clearReminderTargets();
  });

  it("does not throw when no targets are registered", async () => {
    await expect(sendReminder("hello")).resolves.toBeUndefined();
    expect(sendBotText).not.toHaveBeenCalled();
  });

  it("dispatches to both telegram and whatsapp targets", async () => {
    const tgBot = { api: {} } as never;
    const waBot = {
      sendText: vi.fn(async () => undefined),
    } as unknown as Parameters<typeof registerReminderTarget>[0] extends infer T
      ? T extends { platform: "whatsapp"; bot: infer B }
        ? B
        : never
      : never;

    registerReminderTarget({ platform: "telegram", bot: tgBot, chatId: 42 });
    registerReminderTarget({ platform: "whatsapp", bot: waBot, jid: "x@s.whatsapp.net" });

    await sendReminder("ping");

    expect(sendBotText).toHaveBeenCalledTimes(1);
    expect((waBot as { sendText: ReturnType<typeof vi.fn> }).sendText).toHaveBeenCalledWith(
      "x@s.whatsapp.net",
      "ping",
    );
  });

  it("replaces an existing target of the same platform when re-registered", async () => {
    const firstWa = { sendText: vi.fn(async () => undefined) };
    const secondWa = { sendText: vi.fn(async () => undefined) };

    registerReminderTarget({
      platform: "whatsapp",
      bot: firstWa as never,
      jid: "first@s.whatsapp.net",
    });
    registerReminderTarget({
      platform: "whatsapp",
      bot: secondWa as never,
      jid: "second@s.whatsapp.net",
    });

    await sendReminder("ping");

    expect(firstWa.sendText).not.toHaveBeenCalled();
    expect(secondWa.sendText).toHaveBeenCalledTimes(1);
  });

  it("survives one target throwing without aborting the others", async () => {
    const failing = {
      sendText: vi.fn(async () => {
        throw new Error("boom");
      }),
    };
    const ok = { sendText: vi.fn(async () => undefined) };

    registerReminderTarget({
      platform: "whatsapp",
      bot: failing as never,
      jid: "a@s.whatsapp.net",
    });
    // We can only register one target per platform; for this case we just
    // verify that the failing whatsapp target doesn't break a telegram
    // target registered alongside.
    const tgBot = { api: {} } as never;
    registerReminderTarget({ platform: "telegram", bot: tgBot, chatId: 1 });

    await expect(sendReminder("ping")).resolves.toBeUndefined();
    expect(failing.sendText).toHaveBeenCalled();
    expect(sendBotText).toHaveBeenCalledTimes(1);
    void ok;
  });
});
