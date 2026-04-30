import type { Bot, Context } from "grammy";
import { t } from "../i18n/index.js";
import { logger } from "../utils/logger.js";
import { getCurrentSession } from "../session/manager.js";
import { processUserPrompt, type ProcessPromptDeps } from "../bot/handlers/prompt.js";
import { consumeDelivery, peekDelivery } from "./delivery-store.js";

export const CRON_DELIVERY_CALLBACK_PREFIX = "cron:";
const CONTINUE_PREFIX = "cron:continue:";
const CANCEL_PREFIX = "cron:cancel:";

function buildInjectionText(originalPrompt: string, resultText: string): string {
  return [
    "[INSTRUCCIÓN DEL SISTEMA — NO LA REPITAS LITERALMENTE]",
    "Acabas de terminar de ejecutar un cron job programado en segundo plano.",
    'Comunícale el resultado al usuario hablando en primera persona, comenzando literalmente con "Soy yo y acabo de ejecutar".',
    "Sé conciso, claro, y no inventes información que no esté en el resultado del cron.",
    "Después puedes ofrecer continuar la conversación a partir de ese resultado.",
    "",
    `Prompt del cron job ejecutado: ${originalPrompt}`,
    "",
    "Resultado obtenido:",
    resultText,
  ].join("\n");
}

export async function handleCronDeliveryCallback(
  ctx: Context,
  deps: ProcessPromptDeps,
): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(CRON_DELIVERY_CALLBACK_PREFIX)) {
    return false;
  }

  if (data.startsWith(CANCEL_PREFIX)) {
    const deliveryId = data.slice(CANCEL_PREFIX.length);
    consumeDelivery(deliveryId);
    await ctx.answerCallbackQuery({ text: t("cron.delivery.discarded_callback") });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await ctx.reply(t("cron.delivery.discarded")).catch(() => {});
    return true;
  }

  if (!data.startsWith(CONTINUE_PREFIX)) {
    return false;
  }

  const deliveryId = data.slice(CONTINUE_PREFIX.length);
  const peeked = peekDelivery(deliveryId);

  if (!peeked) {
    await ctx.answerCallbackQuery({
      text: t("cron.delivery.expired"),
      show_alert: true,
    });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    return true;
  }

  const currentSession = getCurrentSession();
  if (!currentSession) {
    await ctx.answerCallbackQuery({
      text: t("cron.delivery.no_active_session"),
      show_alert: true,
    });
    return true;
  }

  const delivery = consumeDelivery(deliveryId);
  if (!delivery) {
    await ctx.answerCallbackQuery({
      text: t("cron.delivery.expired"),
      show_alert: true,
    });
    return true;
  }

  await ctx.answerCallbackQuery({ text: t("cron.delivery.continuing_callback") });
  await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

  try {
    const injectedText = buildInjectionText(delivery.prompt, delivery.resultText);
    await processUserPrompt(ctx, injectedText, deps);
  } catch (error) {
    logger.error("[CronDelivery] Failed to inject delivery into active session", error);
    await ctx.reply(t("cron.delivery.inject_failed")).catch(() => {});
  }

  return true;
}

export type { ProcessPromptDeps };
export type CronDeliveryDeps = ProcessPromptDeps & { bot: Bot<Context> };
