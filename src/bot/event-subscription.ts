import { config } from "../config.js";
import { attachManager } from "../attach/manager.js";
import { markAttachedSessionBusy, markAttachedSessionIdle } from "../attach/service.js";
import { externalUserInputSuppressionManager } from "../external-input/suppression.js";
import { getUiPreferences } from "../settings/manager.js";

/**
 * Tool-call messages are hidden when either the static env-var setting
 * (HIDE_TOOL_CALL_MESSAGES) is on, or the runtime UI preference set via
 * /show_tools off is in effect. The runtime check is re-read on every
 * event so /show_tools toggles apply without restarting the bot.
 */
function shouldHideToolMessages(): boolean {
  if (config.bot.hideToolCallMessages) return true;
  return !getUiPreferences().showToolMessages;
}
import { t } from "../i18n/index.js";
import { interactionManager as _interactionManager } from "../interaction/manager.js";
import { clearAllInteractionState } from "../interaction/cleanup.js";
import { keyboardManager } from "../keyboard/manager.js";
import { subscribeToEvents } from "../opencode/events.js";
import { pinnedMessageManager } from "../pinned/manager.js";
import { questionManager } from "../question/manager.js";
import { foregroundSessionState } from "../scheduled-task/foreground-state.js";
import { scheduledTaskRuntime } from "../scheduled-task/runtime.js";
import { ingestSessionInfoForCache } from "../session/cache-manager.js";
import { getCurrentSession } from "../session/manager.js";
import { summaryAggregator } from "../summary/aggregator.js";
import { formatToolInfo } from "../summary/formatter.js";
import { renderSubagentCards } from "../summary/subagent-formatter.js";
import type { ToolMessageBatcher } from "../summary/tool-message-batcher.js";
import { flushTtsText, accumulateTtsText } from "../tts/client.js";
import { logger } from "../utils/logger.js";
import { safeBackgroundTask } from "../utils/safe-background-task.js";
import { assistantRunState } from "./assistant-run-state.js";
import {
  getEventSessionId,
  getToolStreamKey,
  prepareDocumentCaption,
  shouldMarkAttachedBusyFromEvent,
} from "./event-helpers.js";
import { showPermissionRequest } from "./handlers/permission.js";
import { showCurrentQuestion } from "./handlers/question.js";
import { clearPromptResponseMode } from "./handlers/prompt.js";
import {
  enqueueSessionCompletionTask,
  getSessionCompletionTask,
} from "./session-task-queue.js";
import type { ResponseStreamer, StreamingMessagePayload } from "./streaming/response-streamer.js";
import type { ToolCallStreamer } from "./streaming/tool-call-streamer.js";
import type { BotContext } from "./streamers-wiring.js";
import { renderAssistantFinalPartsSafe } from "./utils/assistant-rendering.js";
import { formatAssistantRunFooter } from "./utils/assistant-run-footer.js";
import { deliverExternalUserInputNotification } from "./utils/external-user-input.js";
import { finalizeAssistantResponse } from "./utils/finalize-assistant-response.js";
import { sendTtsResponseForSession } from "./utils/send-tts-response.js";
import { sendBotText, sendRenderedBotPart } from "./utils/telegram-text.js";
import { deliverThinkingMessage } from "./utils/thinking-message.js";

// Reference kept to avoid an "imported but unused" lint when the module is
// referenced for type narrowing only in some configurations.
void _interactionManager;

const SESSION_RETRY_PREFIX = "🔁";
const SUBAGENT_STREAM_PREFIX = "🧩";

export interface EventSubscriptionDeps {
  ctx: BotContext;
  toolMessageBatcher: ToolMessageBatcher;
  responseStreamer: ResponseStreamer;
  toolCallStreamer: ToolCallStreamer;
  prepareStreamingPayload: (text: string) => StreamingMessagePayload | null;
  prepareFinalStreamingPayload: (text: string) => StreamingMessagePayload | null;
}

/**
 * Builds the OpenCode event subscriber. The returned function wires up every
 * callback on the summary aggregator and starts an SSE subscription against
 * the OpenCode server for the given project directory.
 *
 * Dependencies that change at runtime (the grammY bot instance, the active
 * chat id) are accessed through `deps.ctx` getters rather than closed over
 * directly, so the subscriber stays in sync with the bot lifecycle.
 */
export function createEventSubscriber(
  deps: EventSubscriptionDeps,
): (directory: string) => Promise<void> {
  const { ctx, toolMessageBatcher, responseStreamer, toolCallStreamer } = deps;

  return async function ensureEventSubscription(directory: string): Promise<void> {
    if (!directory) {
      logger.error("No directory found for event subscription");
      return;
    }

    summaryAggregator.setTypingIndicatorEnabled(true);
    summaryAggregator.setOnCleared(() => {
      toolMessageBatcher.clearAll("summary_aggregator_clear");
      toolCallStreamer.clearAll("summary_aggregator_clear");
      responseStreamer.clearAll("summary_aggregator_clear");
    });

    summaryAggregator.setOnPartial((sessionId, messageId, messageText) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      const preparedStreamPayload = deps.prepareStreamingPayload(messageText);
      if (!preparedStreamPayload) {
        return;
      }

      // Reply keyboards make the first streamed message non-editable in Telegram,
      // so partial chunks must be sent without reply_markup and finalized later.
      preparedStreamPayload.sendOptions = { disable_notification: true };
      preparedStreamPayload.editOptions = undefined;

      responseStreamer.enqueue(sessionId, messageId, preparedStreamPayload);
    });

    summaryAggregator.setOnComplete((sessionId, messageId, messageText, completionInfo) => {
      void enqueueSessionCompletionTask(sessionId, async () => {
        const bot = ctx.getBot();
        const chatId = ctx.getChatId();
        if (!bot || !chatId) {
          logger.error("Bot or chat ID not available for sending message");
          clearPromptResponseMode(sessionId);
          responseStreamer.clearMessage(sessionId, messageId, "bot_context_missing");
          toolCallStreamer.clearSession(sessionId, "bot_context_missing");
          assistantRunState.clearRun(sessionId, "bot_context_missing");
          foregroundSessionState.markIdle(sessionId);
          return;
        }

        const currentSession = getCurrentSession();
        if (currentSession?.id !== sessionId) {
          clearPromptResponseMode(sessionId);
          responseStreamer.clearMessage(sessionId, messageId, "session_mismatch");
          toolCallStreamer.clearSession(sessionId, "session_mismatch");
          assistantRunState.clearRun(sessionId, "session_mismatch");
          foregroundSessionState.markIdle(sessionId);
          await scheduledTaskRuntime.flushDeferredDeliveries();
          return;
        }

        const botApi = bot.api;

        try {
          assistantRunState.markResponseCompleted(sessionId, {
            agent: completionInfo.agent,
            providerID: completionInfo.providerID,
            modelID: completionInfo.modelID,
          });

          await finalizeAssistantResponse({
            sessionId,
            messageId,
            messageText,
            responseStreamer,
            flushPendingServiceMessages: () =>
              Promise.all([
                toolMessageBatcher.flushSession(sessionId, "assistant_message_completed"),
                toolCallStreamer.breakSession(sessionId, "assistant_message_completed"),
              ]).then(() => undefined),
            prepareStreamingPayload: deps.prepareFinalStreamingPayload,
            renderFinalParts: (text) => renderAssistantFinalPartsSafe(text),
            getReplyKeyboard: ctx.getCurrentReplyKeyboard as never,
            sendRenderedPart: async (part, options) => {
              await sendRenderedBotPart({
                api: botApi,
                chatId,
                part,
                options: options as Parameters<typeof sendBotText>[0]["options"],
              });
            },
          });

          // In waitForIdle mode, accumulate text instead of sending audio immediately
          if (config.tts.waitForIdle) {
            accumulateTtsText(sessionId, messageText);
          } else {
            await sendTtsResponseForSession({
              api: botApi,
              sessionId,
              chatId,
              text: messageText,
            });
          }
        } catch (err) {
          clearPromptResponseMode(sessionId);
          assistantRunState.clearRun(sessionId, "assistant_finalize_failed");
          logger.error("Failed to send message to Telegram:", err);
          // Stop processing events after critical error to prevent infinite loop
          logger.error("[Bot] CRITICAL: Stopping event processing due to error");
          summaryAggregator.clear();
          foregroundSessionState.markIdle(sessionId);
        } finally {
          await scheduledTaskRuntime.flushDeferredDeliveries();
        }
      });
    });

    summaryAggregator.setOnExternalUserInput(async (sessionId, _messageId, messageText) => {
      void enqueueSessionCompletionTask(sessionId, async () => {
        const bot = ctx.getBot();
        const chatId = ctx.getChatId();
        if (!bot || !chatId) {
          return;
        }

        try {
          await deliverExternalUserInputNotification({
            api: bot.api,
            chatId,
            currentSessionId: getCurrentSession()?.id ?? null,
            sessionId,
            text: messageText,
            consumeSuppressedInput: (incomingSessionId, incomingText) =>
              externalUserInputSuppressionManager.consume(incomingSessionId, incomingText),
          });
        } catch (err) {
          logger.error("[Bot] Failed to deliver external user input to Telegram:", err);
        }
      });
    });

    summaryAggregator.setOnTool(async (toolInfo) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        logger.error("Bot or chat ID not available for sending tool notification");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== toolInfo.sessionId) {
        return;
      }

      const shouldIncludeToolInfoInFileCaption =
        toolInfo.hasFileAttachment &&
        (toolInfo.tool === "write" ||
          toolInfo.tool === "edit" ||
          toolInfo.tool === "apply_patch");

      if (
        shouldHideToolMessages() ||
        shouldIncludeToolInfoInFileCaption ||
        toolInfo.tool === "task"
      ) {
        return;
      }

      try {
        const message = formatToolInfo(toolInfo);
        if (message) {
          toolCallStreamer.append(toolInfo.sessionId, message, getToolStreamKey(toolInfo.tool));
        }
      } catch (err) {
        logger.error("Failed to send tool notification to Telegram:", err);
      }
    });

    summaryAggregator.setOnSubagent(async (sessionId, subagents) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      if (shouldHideToolMessages()) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      try {
        const renderedCards = await renderSubagentCards(subagents);
        if (!renderedCards) {
          return;
        }

        toolCallStreamer.replaceByPrefix(
          sessionId,
          SUBAGENT_STREAM_PREFIX,
          renderedCards,
          "subagent",
        );
      } catch (err) {
        logger.error("Failed to render subagent activity for Telegram:", err);
      }
    });

    summaryAggregator.setOnToolFile(async (fileInfo) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        logger.error("Bot or chat ID not available for sending file");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== fileInfo.sessionId) {
        return;
      }

      if (config.bot.hideToolFileMessages) {
        return;
      }

      try {
        await toolCallStreamer.breakSession(fileInfo.sessionId, "tool_file_boundary");

        const toolMessage = formatToolInfo(fileInfo);
        const caption = prepareDocumentCaption(toolMessage || fileInfo.fileData.caption);

        toolMessageBatcher.enqueueFile(fileInfo.sessionId, {
          ...fileInfo.fileData,
          caption,
        });
      } catch (err) {
        logger.error("Failed to send file to Telegram:", err);
      }
    });

    summaryAggregator.setOnQuestion(async (questions, requestID, sessionId) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        logger.error("Bot or chat ID not available for showing questions");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      await Promise.all([
        toolMessageBatcher.flushSession(currentSession.id, "question_asked"),
        toolCallStreamer.flushSession(currentSession.id, "question_asked"),
      ]);

      if (questionManager.isActive()) {
        logger.warn("[Bot] Replacing active poll with a new one");

        const previousMessageIds = questionManager.getMessageIds();
        for (const messageId of previousMessageIds) {
          await bot.api.deleteMessage(chatId, messageId).catch(() => {});
        }

        clearAllInteractionState("question_replaced_by_new_poll");
      }

      logger.info(
        `[Bot] Received ${questions.length} questions from agent, requestID=${requestID}`,
      );
      questionManager.startQuestions(questions, requestID);
      await showCurrentQuestion(bot.api, chatId);
    });

    summaryAggregator.setOnQuestionError(async () => {
      logger.info(`[Bot] Question tool failed, clearing active poll and deleting messages`);

      const bot = ctx.getBot();
      const chatId = ctx.getChatId();

      // Delete all messages from the invalid poll
      const messageIds = questionManager.getMessageIds();
      for (const messageId of messageIds) {
        if (chatId && bot) {
          await bot.api.deleteMessage(chatId, messageId).catch((err) => {
            logger.error(`[Bot] Failed to delete question message ${messageId}:`, err);
          });
        }
      }

      clearAllInteractionState("question_error");
    });

    summaryAggregator.setOnPermission(async (request) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        logger.error("Bot or chat ID not available for showing permission request");
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== request.sessionID) {
        return;
      }

      await Promise.all([
        toolMessageBatcher.flushSession(request.sessionID, "permission_asked"),
        toolCallStreamer.flushSession(request.sessionID, "permission_asked"),
      ]);

      logger.info(
        `[Bot] Received permission request from agent: type=${request.permission}, requestID=${request.id}`,
      );
      await showPermissionRequest(bot.api, chatId, request);
    });

    summaryAggregator.setOnThinking(async (sessionId) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      logger.debug("[Bot] Agent started thinking");

      await toolCallStreamer.breakSession(sessionId, "thinking_started");

      deliverThinkingMessage(sessionId, toolMessageBatcher, {
        hideThinkingMessages: config.bot.hideThinkingMessages,
      });

      // Refresh pinned message so it shows the latest in-memory context
      // (accumulated from silent token updates). 1 API call per thinking event.
      if (pinnedMessageManager.isInitialized()) {
        await pinnedMessageManager.refresh();
      }
    });

    summaryAggregator.setOnTokens(async (tokens, isCompleted) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(
          `[Bot] Received tokens: input=${tokens.input}, output=${tokens.output}, completed=${isCompleted}`,
        );

        const contextSize = tokens.input + tokens.cacheRead;
        const contextLimit = pinnedMessageManager.getContextLimit();

        // Skip non-completed messages with zero context: a new assistant message
        // starts with tokens={input:0, ...} which would overwrite valid context
        // from the previous step. Only accept zeros from completed messages.
        if (!isCompleted && contextSize === 0) {
          logger.debug("[Bot] Skipping zero-token intermediate update");
          return;
        }

        // Update both keyboard and pinned state in memory (keeps them in sync)
        if (contextLimit > 0) {
          keyboardManager.updateContext(contextSize, contextLimit);
        }
        pinnedMessageManager.updateTokensSilent(tokens);

        // Full pinned message update (API call) only on completed messages
        if (isCompleted) {
          await pinnedMessageManager.onMessageComplete(tokens);
        }
      } catch (err) {
        logger.error("[Bot] Error updating pinned message with tokens:", err);
      }
    });

    summaryAggregator.setOnCost(async (cost) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.debug(`[Bot] Cost update: $${cost.toFixed(2)}`);
        await pinnedMessageManager.onCostUpdate(cost);
      } catch (err) {
        logger.error("[Bot] Error updating cost:", err);
      }
    });

    summaryAggregator.setOnSessionCompacted(async (sessionId, sessionDirectory) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        logger.info(`[Bot] Session compacted, reloading context: ${sessionId}`);
        await pinnedMessageManager.onSessionCompacted(sessionId, sessionDirectory);
      } catch (err) {
        logger.error("[Bot] Error reloading context after compaction:", err);
      }
    });

    summaryAggregator.setOnSessionIdle(async (sessionId) => {
      // Enqueue the idle-mode TTS in the same per-session queue used by
      // onComplete callbacks. Without this, the TTS synthesis + sendVoice
      // round-trip (~2-4s) for turn N could still be running when turn N+1's
      // onComplete arrives, so turn N+1's text would reach Telegram before
      // turn N's audio. The user would see audio appearing one turn late.
      //
      // By enqueuing here, the next turn's onComplete handler (which is also
      // queued on the same key) cannot start delivering text until this
      // turn's audio is fully sent.
      const earlyBot = ctx.getBot();
      const earlyChatId = ctx.getChatId();
      if (config.tts.waitForIdle && earlyBot && earlyChatId) {
        const api = earlyBot.api;
        const chatId = earlyChatId;
        void enqueueSessionCompletionTask(sessionId, async () => {
          const ttsText = flushTtsText(sessionId);
          if (!ttsText) return;
          await sendTtsResponseForSession({
            api,
            sessionId,
            chatId,
            text: ttsText,
          }).catch((err) => logger.error("[Bot] Failed to send idle TTS audio:", err));
        });
      }

      await markAttachedSessionIdle(sessionId);
      await getSessionCompletionTask(sessionId)?.catch(() => undefined);

      const completedRun = assistantRunState.finishRun(sessionId, "session_idle");
      clearPromptResponseMode(sessionId);

      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      try {
        await Promise.all([
          toolMessageBatcher.flushSession(sessionId, "session_idle"),
          toolCallStreamer.flushSession(sessionId, "session_idle"),
        ]);

        if (completedRun?.hasCompletedResponse && !config.bot.hideAssistantFooter) {
          const agent = completedRun.actualAgent || completedRun.configuredAgent;
          const providerID = completedRun.actualProviderID || completedRun.configuredProviderID;
          const modelID = completedRun.actualModelID || completedRun.configuredModelID;

          if (agent && providerID && modelID) {
            const keyboard = ctx.getCurrentReplyKeyboard();
            await bot.api.sendMessage(
              chatId,
              formatAssistantRunFooter({
                agent,
                providerID,
                modelID,
                elapsedMs: Date.now() - completedRun.startedAt,
              }),
              {
                ...(keyboard ? { reply_markup: keyboard as never } : {}),
              },
            );
          }
        }
      } catch (err) {
        logger.error("[Bot] Failed to send session idle footer:", err);
      } finally {
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
      }
    });

    summaryAggregator.setOnSessionError(async (sessionId, message) => {
      await markAttachedSessionIdle(sessionId);

      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        clearPromptResponseMode(sessionId);
        assistantRunState.clearRun(sessionId, "session_error_no_bot_context");
        foregroundSessionState.markIdle(sessionId);
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        clearPromptResponseMode(sessionId);
        responseStreamer.clearSession(sessionId, "session_error_not_current");
        toolCallStreamer.clearSession(sessionId, "session_error_not_current");
        assistantRunState.clearRun(sessionId, "session_error_not_current");
        foregroundSessionState.markIdle(sessionId);
        await scheduledTaskRuntime.flushDeferredDeliveries();
        return;
      }

      responseStreamer.clearSession(sessionId, "session_error");
      clearPromptResponseMode(sessionId);
      assistantRunState.clearRun(sessionId, "session_error");
      await Promise.all([
        toolMessageBatcher.flushSession(sessionId, "session_error"),
        toolCallStreamer.flushSession(sessionId, "session_error"),
      ]);

      const normalizedMessage = message.trim() || t("common.unknown_error");
      const truncatedMessage =
        normalizedMessage.length > 3500
          ? `${normalizedMessage.slice(0, 3497)}...`
          : normalizedMessage;

      await bot.api
        .sendMessage(chatId, t("bot.session_error", { message: truncatedMessage }))
        .catch((err) => {
          logger.error("[Bot] Failed to send session.error message:", err);
        });

      foregroundSessionState.markIdle(sessionId);
      await scheduledTaskRuntime.flushDeferredDeliveries();
    });

    summaryAggregator.setOnSessionRetry(async ({ sessionId, message }) => {
      const bot = ctx.getBot();
      const chatId = ctx.getChatId();
      if (!bot || !chatId) {
        return;
      }

      const currentSession = getCurrentSession();
      if (!currentSession || currentSession.id !== sessionId) {
        return;
      }

      const normalizedMessage = message.trim() || t("common.unknown_error");
      const truncatedMessage =
        normalizedMessage.length > 3500
          ? `${normalizedMessage.slice(0, 3497)}...`
          : normalizedMessage;

      const retryMessage = t("bot.session_retry", { message: truncatedMessage });
      toolCallStreamer.replaceByPrefix(sessionId, SESSION_RETRY_PREFIX, retryMessage);
    });

    summaryAggregator.setOnSessionDiff(async (_sessionId, diffs) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }

      try {
        await pinnedMessageManager.onSessionDiff(diffs);
      } catch (err) {
        logger.error("[Bot] Error updating session diff:", err);
      }
    });

    summaryAggregator.setOnFileChange((change) => {
      if (!pinnedMessageManager.isInitialized()) {
        return;
      }
      pinnedMessageManager.addFileChange(change);
    });

    pinnedMessageManager.setOnKeyboardUpdate(async (tokensUsed, tokensLimit) => {
      try {
        logger.debug(`[Bot] Updating keyboard with context: ${tokensUsed}/${tokensLimit}`);
        keyboardManager.updateContext(tokensUsed, tokensLimit);
        // Don't send automatic keyboard updates - keyboard will update naturally with user messages
      } catch (err) {
        logger.error("[Bot] Error updating keyboard context:", err);
      }
    });

    logger.info(`[Bot] Subscribing to OpenCode events for project: ${directory}`);
    subscribeToEvents(directory, (event) => {
      const attached = attachManager.getSnapshot();
      const eventSessionId = getEventSessionId(event);
      if (
        attached &&
        eventSessionId === attached.sessionId &&
        shouldMarkAttachedBusyFromEvent(event)
      ) {
        void markAttachedSessionBusy(attached.sessionId);
      }

      if (event.type === "session.created" || event.type === "session.updated") {
        const info = (
          event.properties as { info?: { directory?: string; time?: { updated?: number } } }
        ).info;

        if (info?.directory) {
          safeBackgroundTask({
            taskName: `session.cache.${event.type}`,
            task: () => ingestSessionInfoForCache(info),
          });
        }
      }

      summaryAggregator.processEvent(event);
    }).catch((err) => {
      logger.error("Failed to subscribe to events:", err);
    });
  };
}
