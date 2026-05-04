import { promises as fs } from "fs";
import * as path from "path";
import type { Bot, Context } from "grammy";
import { InputFile } from "grammy";

import { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { ResponseStreamer } from "./streaming/response-streamer.js";
import { ToolCallStreamer } from "./streaming/tool-call-streamer.js";
import { getCurrentSession } from "../session/manager.js";
import { logger } from "../utils/logger.js";
import {
  editRenderedBotPart,
  getTelegramRenderedPartSignature,
  sendRenderedBotPart,
} from "./utils/telegram-text.js";

/**
 * Runtime accessors that the streamers need at call time. Streamers are
 * instantiated at module evaluation time, but the bot instance and chat ID
 * are only known after `createBot()` runs, so we pass getters instead of
 * raw values. The keyboard accessor returns whatever the project's keyboard
 * manager produces (a grammY reply markup or undefined).
 */
export interface BotContext {
  getBot(): Bot<Context> | null;
  getChatId(): number | null;
  getCurrentReplyKeyboard(): unknown;
}

export function createToolMessageBatcher(deps: {
  ctx: BotContext;
  tempDir: string;
}): ToolMessageBatcher {
  const { ctx, tempDir } = deps;

  return new ToolMessageBatcher({
    sendText: async (sessionId, text) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      const keyboard = ctx.getCurrentReplyKeyboard();

      await bot.api.sendMessage(chatId, text, {
        disable_notification: true,
        ...(keyboard ? { reply_markup: keyboard as never } : {}),
      });
    },
    sendFile: async (sessionId, fileData) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      const tempFilePath = path.join(tempDir, fileData.filename);

      try {
        logger.debug(
          `[Bot] Sending code file: ${fileData.filename} (${fileData.buffer.length} bytes, session=${sessionId})`,
        );

        await fs.mkdir(tempDir, { recursive: true });
        await fs.writeFile(tempFilePath, fileData.buffer);

        const keyboard = ctx.getCurrentReplyKeyboard();

        await bot.api.sendDocument(chatId, new InputFile(tempFilePath), {
          caption: fileData.caption,
          disable_notification: true,
          ...(keyboard ? { reply_markup: keyboard as never } : {}),
        });
      } finally {
        await fs.unlink(tempFilePath).catch(() => {});
      }
    },
  });
}

export function createResponseStreamer(deps: {
  ctx: BotContext;
  throttleMs: number;
}): ResponseStreamer {
  const { ctx, throttleMs } = deps;

  return new ResponseStreamer({
    throttleMs,
    sendPart: async (part, options) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for streamed send");
      }

      return sendRenderedBotPart({
        api: bot.api,
        chatId,
        part,
        options,
      });
    },
    editPart: async (messageId, part, options) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for streamed edit");
      }

      try {
        return await editRenderedBotPart({
          api: bot.api,
          chatId,
          messageId,
          part,
          options,
        });
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (errorMessage.includes("message is not modified")) {
          return {
            deliveredSignature: getTelegramRenderedPartSignature(part),
          };
        }

        throw error;
      }
    },
    deleteText: async (messageId) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for streamed delete");
      }

      await bot.api.deleteMessage(chatId, messageId).catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (
          errorMessage.includes("message to delete not found") ||
          errorMessage.includes("message identifier is not specified")
        ) {
          return;
        }

        throw error;
      });
    },
  });
}

export function createToolCallStreamer(deps: {
  ctx: BotContext;
  throttleMs: number;
}): ToolCallStreamer {
  const { ctx, throttleMs } = deps;

  return new ToolCallStreamer({
    throttleMs,
    sendText: async (sessionId, text) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for tool stream send");
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        throw new Error(`Tool stream session mismatch for send: ${sessionId}`);
      }

      const sentMessage = await bot.api.sendMessage(chatId, text, {
        disable_notification: true,
      });

      return sentMessage.message_id;
    },
    editText: async (sessionId, messageId, text) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for tool stream edit");
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        throw new Error(`Tool stream session mismatch for edit: ${sessionId}`);
      }

      try {
        await bot.api.editMessageText(chatId, messageId, text);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (errorMessage.includes("message is not modified")) {
          return;
        }

        throw error;
      }
    },
    deleteText: async (sessionId, messageId) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId || chatId <= 0) {
        throw new Error("Bot context missing for tool stream delete");
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        throw new Error(`Tool stream session mismatch for delete: ${sessionId}`);
      }

      await bot.api.deleteMessage(chatId, messageId).catch((error) => {
        const errorMessage =
          error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
        if (
          errorMessage.includes("message to delete not found") ||
          errorMessage.includes("message identifier is not specified")
        ) {
          return;
        }

        throw error;
      });
    },
  });
}
