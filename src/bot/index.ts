import { Bot, Context, NextFunction } from "grammy";
import * as path from "path";
import { fileURLToPath } from "url";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpsProxyAgent } from "https-proxy-agent";
import { config } from "../config.js";
import { authMiddleware } from "./middleware/auth.js";
import { interactionGuardMiddleware } from "./middleware/interaction-guard.js";
import { unknownCommandMiddleware } from "./middleware/unknown-command.js";
import { BOT_COMMANDS } from "./commands/definitions.js";
import { startCommand } from "./commands/start.js";
import { helpCommand } from "./commands/help.js";
import { statusCommand } from "./commands/status.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
  VARIANT_BUTTON_TEXT_PATTERN,
} from "./message-patterns.js";
import { sessionsCommand, handleSessionSelect } from "./commands/sessions.js";
import { newCommand } from "./commands/new.js";
import { projectsCommand, handleProjectSelect } from "./commands/projects.js";
import { worktreeCommand, handleWorktreeCallback } from "./commands/worktree.js";
import { openCommand, handleOpenCallback, clearOpenPathIndex } from "./commands/open.js";
import { abortCommand } from "./commands/abort.js";
import { opencodeStartCommand } from "./commands/opencode-start.js";
import { opencodeStopCommand } from "./commands/opencode-stop.js";
import { renameCommand, handleRenameCancel, handleRenameTextAnswer } from "./commands/rename.js";
import { handleTaskCallback, handleTaskTextInput, taskCommand } from "./commands/task.js";
import { handleTaskListCallback, taskListCommand } from "./commands/tasklist.js";
import { handleCronDeliveryCallback } from "../cron/delivery-handler.js";
import {
  commandsCommand,
  handleCommandsCallback,
  handleCommandTextArguments,
} from "./commands/commands.js";
import { mcpsCommand, handleMcpsCallback } from "./commands/mcps.js";
import { ttsCommand } from "./commands/tts.js";
import { registerMemoryCommands } from "./commands/memory-commands.js";
import { clearSessionTracker } from "../memory/session-tracker.js";
import { handleQuestionCallback, handleQuestionTextAnswer } from "./handlers/question.js";
import { handlePermissionCallback } from "./handlers/permission.js";
import { handleAgentSelect, showAgentSelectionMenu } from "./handlers/agent.js";
import {
  handleModelApiKeyInput,
  handleModelSelect,
  showModelSelectionMenu,
} from "./handlers/model.js";
import { handleVariantSelect, showVariantSelectionMenu } from "./handlers/variant.js";
import { handleContextButtonPress, handleCompactConfirm } from "./handlers/context.js";
import { handleInlineMenuCancel } from "./handlers/inline-menu.js";
import { questionManager } from "../question/manager.js";
import { interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { stopEventListening } from "../opencode/events.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { withTelegramRateLimitRetry } from "../utils/telegram-rate-limit-retry.js";
import { t } from "../i18n/index.js";
import { processUserPrompt } from "./handlers/prompt.js";
import { handleVoiceMessage } from "./handlers/voice.js";
import { handleDocumentMessage } from "./handlers/document.js";
import { downloadTelegramFile, toDataUri } from "./utils/file-download.js";
import type { FilePartInput } from "@opencode-ai/sdk/v2";
import { assistantRunState } from "./assistant-run-state.js";
import { clearSessionCompletionTasks } from "./session-task-queue.js";
import type { StreamingMessagePayload } from "./streaming/response-streamer.js";
import {
  type BotContext,
  createResponseStreamer,
  createToolCallStreamer,
  createToolMessageBatcher,
} from "./streamers-wiring.js";
import { createEventSubscriber } from "./event-subscription.js";
import { attachManager } from "../attach/manager.js";
import { restoreAttachedCurrentSession } from "../attach/service.js";
import {
  prepareAssistantFinalStreamingPayload,
  prepareAssistantStreamingPayload,
} from "./utils/assistant-rendering.js";

let botInstance: Bot<Context> | null = null;
let chatIdInstance: number | null = null;
let commandsInitialized = false;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

const RESPONSE_STREAM_THROTTLE_MS = config.bot.responseStreamThrottleMs;
const RESPONSE_STREAM_TEXT_LIMIT = 3800;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.join(__dirname, "..", ".tmp");

function getCurrentReplyKeyboard() {
  if (!keyboardManager.isInitialized()) {
    return undefined;
  }

  return keyboardManager.getKeyboard();
}

function prepareStreamingPayload(messageText: string): StreamingMessagePayload | null {
  return prepareAssistantStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
}

function prepareFinalStreamingPayload(messageText: string): StreamingMessagePayload | null {
  return prepareAssistantFinalStreamingPayload(messageText, RESPONSE_STREAM_TEXT_LIMIT);
}



const botContext: BotContext = {
  getBot: () => botInstance,
  getChatId: () => chatIdInstance,
  getCurrentReplyKeyboard,
};

const toolMessageBatcher = createToolMessageBatcher({
  ctx: botContext,
  tempDir: TEMP_DIR,
});

const responseStreamer = createResponseStreamer({
  ctx: botContext,
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
});

const toolCallStreamer = createToolCallStreamer({
  ctx: botContext,
  throttleMs: RESPONSE_STREAM_THROTTLE_MS,
});

async function ensureCommandsInitialized(ctx: Context, next: NextFunction): Promise<void> {
  if (commandsInitialized || !ctx.from || ctx.from.id !== config.telegram.allowedUserId) {
    await next();
    return;
  }

  if (!ctx.chat) {
    logger.warn("[Bot] Cannot initialize commands: chat context is missing");
    await next();
    return;
  }

  try {
    await ctx.api.setMyCommands(BOT_COMMANDS, {
      scope: {
        type: "chat",
        chat_id: ctx.chat.id,
      },
    });

    commandsInitialized = true;
    logger.debug(`[Bot] Commands initialized for authorized user (chat_id=${ctx.chat.id})`);
  } catch (err) {
    logger.error("[Bot] Failed to set commands:", err);
  }

  await next();
}

const ensureEventSubscription = createEventSubscriber({
  ctx: botContext,
  toolMessageBatcher,
  responseStreamer,
  toolCallStreamer,
  prepareStreamingPayload,
  prepareFinalStreamingPayload,
});

export function createBot(): Bot<Context> {
  clearAllInteractionState("bot_startup");
  clearSessionCompletionTasks();
  attachManager.clear("bot_startup");
  assistantRunState.clearAll("bot_startup");

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  const botOptions: ConstructorParameters<typeof Bot<Context>>[1] = {};

  if (config.telegram.proxyUrl) {
    const proxyUrl = config.telegram.proxyUrl;
    let agent;

    if (proxyUrl.startsWith("socks")) {
      agent = new SocksProxyAgent(proxyUrl);
      logger.info(`[Bot] Using SOCKS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    } else {
      agent = new HttpsProxyAgent(proxyUrl);
      logger.info(`[Bot] Using HTTP/HTTPS proxy: ${proxyUrl.replace(/\/\/.*@/, "//***@")}`);
    }

    botOptions.client = {
      baseFetchConfig: {
        agent,
        compress: true,
      },
    };
  }

  const bot = new Bot(config.telegram.token, botOptions);
  botInstance = bot;
  chatIdInstance = config.telegram.allowedUserId;

  // Heartbeat for diagnostics: verify the event loop is not blocked
  let heartbeatCounter = 0;
  heartbeatTimer = setInterval(() => {
    heartbeatCounter++;
    if (heartbeatCounter % 6 === 0) {
      // Log every 30 seconds (5 sec * 6)
      logger.debug(`[Bot] Heartbeat #${heartbeatCounter} - event loop alive`);
    }
  }, 5000);

  // Log all API calls for diagnostics
  let lastGetUpdatesTime = Date.now();
  bot.api.config.use(async (prev, method, payload, signal) => {
    if (method === "getUpdates") {
      const now = Date.now();
      const timeSinceLast = now - lastGetUpdatesTime;
      logger.debug(`[Bot API] getUpdates called (${timeSinceLast}ms since last)`);
      lastGetUpdatesTime = now;
      return prev(method, payload, signal);
    }

    if (method === "sendMessage") {
      logger.debug(`[Bot API] sendMessage to chat ${(payload as { chat_id?: number }).chat_id}`);
    }

    return withTelegramRateLimitRetry(() => prev(method, payload, signal), {
      maxRetries: 5,
      onRetry: ({ attempt, retryAfterMs, error }) => {
        logger.warn(
          `[Bot API] Telegram rate limit on ${method}, retrying in ${retryAfterMs}ms (attempt=${attempt})`,
          error,
        );
      },
    });
  });

  bot.use((ctx, next) => {
    const hasCallbackQuery = !!ctx.callbackQuery;
    const hasMessage = !!ctx.message;
    const callbackData = ctx.callbackQuery?.data || "N/A";
    logger.debug(
      `[DEBUG] Incoming update: hasCallbackQuery=${hasCallbackQuery}, hasMessage=${hasMessage}, callbackData=${callbackData}`,
    );
    return next();
  });

  bot.use(authMiddleware);
  bot.use(ensureCommandsInitialized);
  bot.use(interactionGuardMiddleware);

  const blockMenuWhileInteractionActive = async (ctx: Context): Promise<boolean> => {
    const activeInteraction = interactionManager.getSnapshot();
    if (!activeInteraction) {
      return false;
    }

    logger.debug(
      `[Bot] Blocking menu open while interaction active: kind=${activeInteraction.kind}, expectedInput=${activeInteraction.expectedInput}`,
    );
    await ctx.reply(t("interaction.blocked.finish_current"));
    return true;
  };

  bot.command("start", startCommand);
  bot.command("help", helpCommand);
  bot.command("status", statusCommand);
  bot.command("tts", ttsCommand);
  bot.command("opencode_start", opencodeStartCommand);
  bot.command("opencode_stop", opencodeStopCommand);
  bot.command("projects", projectsCommand);
  bot.command("worktree", worktreeCommand);
  bot.command("open", openCommand);
  bot.command("sessions", sessionsCommand);
  bot.command("new", (ctx) => newCommand(ctx, { bot, ensureEventSubscription }));
  bot.command("abort", abortCommand);
  bot.command("task", taskCommand);
  bot.command("tasklist", taskListCommand);
  bot.command("rename", renameCommand);
  bot.command("commands", commandsCommand);
  bot.command("mcplist", mcpsCommand);

  // Memory commands: /soul, /memory, /context, /memfiles, /listskill, /skill
  registerMemoryCommands(bot);

  bot.on("message:text", unknownCommandMiddleware);

  bot.on("callback_query:data", async (ctx) => {
    logger.debug(`[Bot] Received callback_query:data: ${ctx.callbackQuery?.data}`);
    logger.debug(`[Bot] Callback context: from=${ctx.from?.id}, chat=${ctx.chat?.id}`);

    if (ctx.chat) {
      botInstance = bot;
      chatIdInstance = ctx.chat.id;
    }

    try {
      const handledInlineCancel = await handleInlineMenuCancel(ctx);
      if (handledInlineCancel) {
        // Clean up path index when the open-directory menu is cancelled
        clearOpenPathIndex();
      }
      const handledSession = await handleSessionSelect(ctx, { bot, ensureEventSubscription });
      const handledProject = await handleProjectSelect(ctx);
      const handledWorktree = await handleWorktreeCallback(ctx);
      const handledOpen = await handleOpenCallback(ctx);
      const handledQuestion = await handleQuestionCallback(ctx);
      const handledPermission = await handlePermissionCallback(ctx);
      const handledAgent = await handleAgentSelect(ctx);
      const handledModel = await handleModelSelect(ctx);
      const handledVariant = await handleVariantSelect(ctx);
      const handledCompactConfirm = await handleCompactConfirm(ctx);
      const handledTask = await handleTaskCallback(ctx);
      const handledTaskList = await handleTaskListCallback(ctx);
      const handledRenameCancel = await handleRenameCancel(ctx);
      const handledCommands = await handleCommandsCallback(ctx, { bot, ensureEventSubscription });
      const handledMcps = await handleMcpsCallback(ctx);
      const handledCronDelivery = await handleCronDeliveryCallback(ctx, {
        bot,
        ensureEventSubscription,
      });

      logger.debug(
        `[Bot] Callback handled: inlineCancel=${handledInlineCancel}, session=${handledSession}, project=${handledProject}, worktree=${handledWorktree}, open=${handledOpen}, question=${handledQuestion}, permission=${handledPermission}, agent=${handledAgent}, model=${handledModel}, variant=${handledVariant}, compactConfirm=${handledCompactConfirm}, task=${handledTask}, taskList=${handledTaskList}, rename=${handledRenameCancel}, commands=${handledCommands}, mcps=${handledMcps}, cronDelivery=${handledCronDelivery}`,
      );

      if (
        !handledInlineCancel &&
        !handledSession &&
        !handledProject &&
        !handledWorktree &&
        !handledOpen &&
        !handledQuestion &&
        !handledPermission &&
        !handledAgent &&
        !handledModel &&
        !handledVariant &&
        !handledCompactConfirm &&
        !handledTask &&
        !handledTaskList &&
        !handledRenameCancel &&
        !handledCommands &&
        !handledMcps &&
        !handledCronDelivery
      ) {
        logger.debug("Unknown callback query:", ctx.callbackQuery?.data);
        await ctx.answerCallbackQuery({ text: t("callback.unknown_command") });
      }
    } catch (err) {
      logger.error("[Bot] Error handling callback:", err);
      clearAllInteractionState("callback_handler_error");
      await ctx.answerCallbackQuery({ text: t("callback.processing_error") }).catch(() => {});
    }
  });

  // Handle Reply Keyboard button press (agent indicator)
  bot.hears(AGENT_MODE_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Agent button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showAgentSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing agent menu:", err);
      await ctx.reply(t("error.load_agents"));
    }
  });

  // Handle Reply Keyboard button press (model selector)
  // Model button text is produced by formatModelForButton() and always starts with "🤖 ".
  bot.hears(MODEL_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Model button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showModelSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing model menu:", err);
      await ctx.reply(t("error.load_models"));
    }
  });

  // Handle Reply Keyboard button press (context button)
  bot.hears(/^📊(?:\s|$)/, async (ctx) => {
    logger.debug(`[Bot] Context button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await handleContextButtonPress(ctx);
    } catch (err) {
      logger.error("[Bot] Error handling context button:", err);
      await ctx.reply(t("error.context_button"));
    }
  });

  // Handle Reply Keyboard button press (variant selector)
  // Keep support for both legacy "💭" and current "💡" prefix.
  bot.hears(VARIANT_BUTTON_TEXT_PATTERN, async (ctx) => {
    logger.debug(`[Bot] Variant button pressed: ${ctx.message?.text}`);

    try {
      if (await blockMenuWhileInteractionActive(ctx)) {
        return;
      }

      await showVariantSelectionMenu(ctx);
    } catch (err) {
      logger.error("[Bot] Error showing variant menu:", err);
      await ctx.reply(t("error.load_variants"));
    }
  });

  bot.on("message:text", async (ctx, next) => {
    const text = ctx.message?.text;
    if (text) {
      const isCommand = text.startsWith("/");
      logger.debug(
        `[Bot] Received text message: ${isCommand ? `command="${text}"` : `prompt (length=${text.length})`}, chatId=${ctx.chat.id}`,
      );
    }
    await next();
  });

  // Remove any previously set global commands to prevent unauthorized users from seeing them
  safeBackgroundTask({
    taskName: "bot.clearGlobalCommands",
    task: async () => {
      try {
        await Promise.all([
          bot.api.setMyCommands([], { scope: { type: "default" } }),
          bot.api.setMyCommands([], { scope: { type: "all_private_chats" } }),
        ]);
        return { success: true as const };
      } catch (error) {
        return { success: false as const, error };
      }
    },
    onSuccess: (result) => {
      if (result.success) {
        logger.debug("[Bot] Cleared global commands (default and all_private_chats scopes)");
        return;
      }

      logger.warn("[Bot] Could not clear global commands:", result.error);
    },
  });

  // Voice and audio message handlers (STT transcription -> prompt)
  const voicePromptDeps = { bot, ensureEventSubscription };

  safeBackgroundTask({
    taskName: "bot.restoreFollowedSession",
    task: () =>
      restoreAttachedCurrentSession({
        bot,
        chatId: config.telegram.allowedUserId,
        ensureEventSubscription,
      }),
  });

  bot.on("message:voice", async (ctx) => {
    logger.debug(`[Bot] Received voice message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  bot.on("message:audio", async (ctx) => {
    logger.debug(`[Bot] Received audio message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    await handleVoiceMessage(ctx, voicePromptDeps);
  });

  // Photo message handler
  bot.on("message:photo", async (ctx) => {
    logger.debug(`[Bot] Received photo message, chatId=${ctx.chat.id}`);

    const photos = ctx.message?.photo;
    if (!photos || photos.length === 0) {
      return;
    }

    const caption = ctx.message.caption || "";

    try {
      // Get the largest photo (last element in array)
      const largestPhoto = photos[photos.length - 1];

      // Download photo
      await ctx.reply(t("bot.photo_downloading"));
      const downloadedFile = await downloadTelegramFile(ctx.api, largestPhoto.file_id);

      // Convert to data URI (Telegram always converts photos to JPEG)
      const dataUri = toDataUri(downloadedFile.buffer, "image/jpeg");

      // Create file part
      const filePart: FilePartInput = {
        type: "file",
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: dataUri,
      };

      logger.info(`[Bot] Sending photo (${downloadedFile.buffer.length} bytes) with prompt`);

      botInstance = bot;
      chatIdInstance = ctx.chat.id;

      // Send via processUserPrompt with file part
      const promptDeps = { bot, ensureEventSubscription };
      await processUserPrompt(ctx, caption, promptDeps, [filePart]);
    } catch (err) {
      logger.error("[Bot] Error handling photo message:", err);
      await ctx.reply(t("bot.photo_download_error"));
    }
  });

  // Document message handler (PDF and text files)
  bot.on("message:document", async (ctx) => {
    logger.debug(`[Bot] Received document message, chatId=${ctx.chat.id}`);
    botInstance = bot;
    chatIdInstance = ctx.chat.id;
    const deps = { bot, ensureEventSubscription };
    await handleDocumentMessage(ctx, deps);
  });

  bot.on("message:text", async (ctx) => {
    const text = ctx.message?.text;
    if (!text) {
      return;
    }

    botInstance = bot;
    chatIdInstance = ctx.chat.id;

    if (text.startsWith("/")) {
      return;
    }

    if (questionManager.isActive()) {
      await handleQuestionTextAnswer(ctx);
      return;
    }

    const handledTask = await handleTaskTextInput(ctx);
    if (handledTask) {
      return;
    }

    const handledRename = await handleRenameTextAnswer(ctx);
    if (handledRename) {
      return;
    }

    const promptDeps = { bot, ensureEventSubscription };
    const handledCommandArgs = await handleCommandTextArguments(ctx, promptDeps);
    if (handledCommandArgs) {
      return;
    }

    const handledApiKey = await handleModelApiKeyInput(ctx);
    if (handledApiKey) {
      return;
    }

    await processUserPrompt(ctx, text, promptDeps);

    logger.debug("[Bot] message:text handler completed (prompt sent in background)");
  });

  bot.catch((err) => {
    logger.error("[Bot] Unhandled error in bot:", err);
    clearAllInteractionState("bot_unhandled_error");
    if (err.ctx) {
      logger.error(
        "[Bot] Error context - update type:",
        err.ctx.update ? Object.keys(err.ctx.update) : "unknown",
      );
    }
  });

  return bot;
}

export function cleanupBotRuntime(reason: string): void {
  stopEventListening();
  summaryAggregator.clear();
  responseStreamer.clearAll(reason);
  toolCallStreamer.clearAll(reason);
  toolMessageBatcher.clearAll(reason);
  clearSessionCompletionTasks();
  assistantRunState.clearAll(reason);
  clearSessionTracker();

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  botInstance = null;
  chatIdInstance = null;
}
