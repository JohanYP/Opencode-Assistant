import { Context, InlineKeyboard } from "grammy";
import {
  selectModel,
  fetchCurrentModel,
  getCategorizedCatalog,
  getProviderAuthMethods,
  setProviderApiKey,
  getProviderOAuthUrl,
  type ProviderEntry,
} from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import type { ModelInfo } from "../../model/types.js";
import { formatVariantForButton } from "../../variant/manager.js";
import { logger } from "../../utils/logger.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { getStoredAgent, resolveProjectAgent } from "../../agent/manager.js";
import { pinnedMessageManager } from "../../pinned/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { t } from "../../i18n/index.js";

const MODEL_CALLBACK_PREFIX = "model:";
const PAGE_SIZE = 8;

type Category = "free" | "paid";
type Stage = "category" | "providers" | "models" | "awaiting_api_key";

interface ModelSelectState {
  flow: "model_select";
  stage: Stage;
  messageId: number;
  category?: Category;
  providers?: ProviderEntry[];
  providerIndex?: number;
  page?: number;
  pendingProviderID?: string;
  pendingModelID?: string;
}

function getCallbackMessageId(ctx: Context): number | null {
  const message = ctx.callbackQuery?.message;
  if (!message || !("message_id" in message)) return null;
  const id = (message as { message_id?: number }).message_id;
  return typeof id === "number" ? id : null;
}

function readState(state: InteractionState | null): ModelSelectState | null {
  if (!state || state.kind !== "custom") return null;
  if (state.metadata.flow !== "model_select") return null;

  const stage = state.metadata.stage;
  const messageId = state.metadata.messageId;
  if (typeof stage !== "string" || typeof messageId !== "number") return null;

  return state.metadata as unknown as ModelSelectState;
}

function clearMenu(reason: string): void {
  const current = interactionManager.getSnapshot();
  if (current?.kind === "custom" && current.metadata.flow === "model_select") {
    interactionManager.clear(reason);
  }
}

function pickCategoryList(state: ModelSelectState): ProviderEntry[] {
  return state.providers ?? [];
}

function totalPages(count: number): number {
  return Math.max(1, Math.ceil(count / PAGE_SIZE));
}

function clampPage(page: number, total: number): number {
  if (!Number.isFinite(page) || page < 0) return 0;
  if (page >= total) return total - 1;
  return page;
}

function truncateLabel(text: string, max = 60): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function buildCategoryKeyboard(): InlineKeyboard {
  const kb = new InlineKeyboard();
  kb.text(t("model.menu.category_free"), `${MODEL_CALLBACK_PREFIX}cat:free`).row();
  kb.text(t("model.menu.category_paid"), `${MODEL_CALLBACK_PREFIX}cat:paid`).row();
  kb.text(t("model.menu.button.cancel"), `${MODEL_CALLBACK_PREFIX}cancel`);
  return kb;
}

function buildProvidersKeyboard(providers: ProviderEntry[], page: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const total = totalPages(providers.length);
  const safePage = clampPage(page, total);
  const start = safePage * PAGE_SIZE;
  const slice = providers.slice(start, start + PAGE_SIZE);

  slice.forEach((p, i) => {
    const idx = start + i;
    const lock = p.authenticated ? "" : "🔒 ";
    const label = truncateLabel(`${lock}${p.name} (${p.models.length})`);
    kb.text(label, `${MODEL_CALLBACK_PREFIX}prov:${idx}`).row();
  });

  if (total > 1) {
    if (safePage > 0) {
      kb.text(t("model.menu.button.prev"), `${MODEL_CALLBACK_PREFIX}page:${safePage - 1}`);
    }
    if (safePage < total - 1) {
      kb.text(t("model.menu.button.next"), `${MODEL_CALLBACK_PREFIX}page:${safePage + 1}`);
    }
    kb.row();
  }

  kb.text(t("model.menu.button.back"), `${MODEL_CALLBACK_PREFIX}back`);
  kb.text(t("model.menu.button.cancel"), `${MODEL_CALLBACK_PREFIX}cancel`);
  return kb;
}

function buildModelsKeyboard(provider: ProviderEntry, current: ModelInfo, page: number): InlineKeyboard {
  const kb = new InlineKeyboard();
  const total = totalPages(provider.models.length);
  const safePage = clampPage(page, total);
  const start = safePage * PAGE_SIZE;
  const slice = provider.models.slice(start, start + PAGE_SIZE);

  slice.forEach((m, i) => {
    const idx = start + i;
    const isActive = current.providerID === provider.id && current.modelID === m.id;
    const prefix = isActive ? "✅ " : "";
    const label = truncateLabel(`${prefix}${m.name}`);
    kb.text(label, `${MODEL_CALLBACK_PREFIX}model:${idx}`).row();
  });

  if (total > 1) {
    if (safePage > 0) {
      kb.text(t("model.menu.button.prev"), `${MODEL_CALLBACK_PREFIX}page:${safePage - 1}`);
    }
    if (safePage < total - 1) {
      kb.text(t("model.menu.button.next"), `${MODEL_CALLBACK_PREFIX}page:${safePage + 1}`);
    }
    kb.row();
  }

  kb.text(t("model.menu.button.back"), `${MODEL_CALLBACK_PREFIX}back`);
  kb.text(t("model.menu.button.cancel"), `${MODEL_CALLBACK_PREFIX}cancel`);
  return kb;
}

function categoryLabel(category: Category): string {
  return category === "free" ? t("model.menu.category_free") : t("model.menu.category_paid");
}

function pageHeader(page: number, total: number): string {
  if (total <= 1) return "";
  return `\n${t("model.menu.page", { page: String(page + 1), total: String(total) })}`;
}

async function commitModelSelection(ctx: Context, modelInfo: ModelInfo): Promise<void> {
  selectModel(modelInfo);
  keyboardManager.updateModel(modelInfo);
  await pinnedMessageManager.refreshContextLimit();

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const contextInfo =
    pinnedMessageManager.getContextInfo() ??
    (pinnedMessageManager.getContextLimit() > 0
      ? { tokensUsed: 0, tokensLimit: pinnedMessageManager.getContextLimit() }
      : null);

  keyboardManager.updateAgent(currentAgent);
  if (contextInfo) {
    keyboardManager.updateContext(contextInfo.tokensUsed, contextInfo.tokensLimit);
  }

  const variantName = formatVariantForButton(modelInfo.variant || "default");
  const keyboard = createMainKeyboard(currentAgent, modelInfo, contextInfo ?? undefined, variantName);
  const displayName = formatModelForDisplay(modelInfo.providerID, modelInfo.modelID);

  await ctx.reply(t("model.changed_message", { name: displayName }), { reply_markup: keyboard });
}

export async function showModelSelectionMenu(ctx: Context): Promise<void> {
  try {
    if (ctx.chat) {
      keyboardManager.initialize(ctx.api, ctx.chat.id);
    }

    const message = await ctx.reply(t("model.menu.category_select"), {
      reply_markup: buildCategoryKeyboard(),
    });

    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "model_select",
        stage: "category",
        messageId: message.message_id,
      },
    });
  } catch (err) {
    logger.error("[ModelHandler] Error showing model menu:", err);
    await ctx.reply(t("model.menu.error"));
  }
}

async function showCategoryStep(ctx: Context, state: ModelSelectState): Promise<void> {
  await ctx.editMessageText(t("model.menu.category_select"), {
    reply_markup: buildCategoryKeyboard(),
  });
  interactionManager.transition({
    expectedInput: "callback",
    metadata: {
      flow: "model_select",
      stage: "category",
      messageId: state.messageId,
    },
  });
}

async function showProvidersStep(
  ctx: Context,
  state: ModelSelectState,
  category: Category,
  page = 0,
): Promise<void> {
  const catalog = await getCategorizedCatalog();
  const providers = category === "free" ? catalog.free : catalog.paid;

  if (providers.length === 0) {
    const kb = new InlineKeyboard()
      .text(t("model.menu.button.back"), `${MODEL_CALLBACK_PREFIX}back`)
      .text(t("model.menu.button.cancel"), `${MODEL_CALLBACK_PREFIX}cancel`);

    await ctx.editMessageText(
      `${categoryLabel(category)}\n\n${t("model.menu.providers_empty")}`,
      { reply_markup: kb },
    );

    interactionManager.transition({
      expectedInput: "callback",
      metadata: {
        flow: "model_select",
        stage: "providers",
        messageId: state.messageId,
        category,
        providers: [],
        page: 0,
      },
    });
    return;
  }

  const total = totalPages(providers.length);
  const safePage = clampPage(page, total);
  const text = `${categoryLabel(category)}\n${t("model.menu.providers_title")}${pageHeader(safePage, total)}`;

  await ctx.editMessageText(text, {
    reply_markup: buildProvidersKeyboard(providers, safePage),
  });

  interactionManager.transition({
    expectedInput: "callback",
    metadata: {
      flow: "model_select",
      stage: "providers",
      messageId: state.messageId,
      category,
      providers,
      page: safePage,
    },
  });
}

async function showModelsStep(
  ctx: Context,
  state: ModelSelectState,
  providerIndex: number,
  page = 0,
): Promise<void> {
  const providers = pickCategoryList(state);
  const provider = providers[providerIndex];
  if (!provider) {
    await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
    return;
  }

  const current = fetchCurrentModel();
  const total = totalPages(provider.models.length);
  const safePage = clampPage(page, total);
  const text = `${t("model.menu.models_title", { provider: provider.name })}${pageHeader(safePage, total)}`;

  await ctx.editMessageText(text, {
    reply_markup: buildModelsKeyboard(provider, current, safePage),
  });

  interactionManager.transition({
    expectedInput: "callback",
    metadata: {
      flow: "model_select",
      stage: "models",
      messageId: state.messageId,
      category: state.category,
      providers: state.providers,
      providerIndex,
      page: safePage,
    },
  });
}

async function startApiKeyCapture(
  ctx: Context,
  state: ModelSelectState,
  providerID: string,
  providerName: string,
  modelID: string,
): Promise<void> {
  await ctx.editMessageText(t("model.auth.api_prompt", { provider: providerName }));

  interactionManager.transition({
    expectedInput: "text",
    metadata: {
      flow: "model_select",
      stage: "awaiting_api_key",
      messageId: state.messageId,
      pendingProviderID: providerID,
      pendingModelID: modelID,
    },
  });
}

async function handleAuthForPendingModel(
  ctx: Context,
  state: ModelSelectState,
  provider: ProviderEntry,
  modelID: string,
): Promise<void> {
  const methods = await getProviderAuthMethods(provider.id);
  if (!methods || methods.length === 0) {
    await ctx.editMessageText(t("model.auth.no_method", { provider: provider.name }));
    clearMenu("model_no_auth_method");
    return;
  }

  const apiMethod = methods.find((m) => m.type === "api");
  if (apiMethod) {
    await startApiKeyCapture(ctx, state, provider.id, provider.name, modelID);
    return;
  }

  const oauthIdx = methods.findIndex((m) => m.type === "oauth");
  if (oauthIdx >= 0) {
    const oauth = await getProviderOAuthUrl(provider.id, oauthIdx);
    if (!oauth) {
      await ctx.editMessageText(t("model.auth.oauth_failed", { provider: provider.name }));
      clearMenu("model_oauth_failed");
      return;
    }
    await ctx.editMessageText(
      t("model.auth.oauth_link", {
        provider: provider.name,
        url: oauth.url,
        instructions: oauth.instructions,
      }),
    );
    clearMenu("model_oauth_link_sent");
    return;
  }

  await ctx.editMessageText(t("model.auth.no_method", { provider: provider.name }));
  clearMenu("model_unknown_auth_method");
}

export async function handleModelSelect(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MODEL_CALLBACK_PREFIX)) {
    return false;
  }

  const state = readState(interactionManager.getSnapshot());
  const callbackMessageId = getCallbackMessageId(ctx);

  if (!state || callbackMessageId === null || state.messageId !== callbackMessageId) {
    await ctx
      .answerCallbackQuery({ text: t("inline.inactive_callback"), show_alert: true })
      .catch(() => {});
    return true;
  }

  const action = data.slice(MODEL_CALLBACK_PREFIX.length);

  try {
    if (action === "cancel") {
      clearMenu("model_select_cancel");
      await ctx.answerCallbackQuery().catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (action === "back") {
      await ctx.answerCallbackQuery().catch(() => {});
      if (state.stage === "providers") {
        await showCategoryStep(ctx, state);
      } else if (state.stage === "models" && state.category) {
        await showProvidersStep(ctx, state, state.category, state.page ?? 0);
      } else {
        await showCategoryStep(ctx, state);
      }
      return true;
    }

    if (action.startsWith("cat:")) {
      const cat = action.slice(4);
      if (cat !== "free" && cat !== "paid") {
        await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
        return true;
      }
      await ctx.answerCallbackQuery().catch(() => {});
      await showProvidersStep(ctx, state, cat, 0);
      return true;
    }

    if (action.startsWith("page:")) {
      const page = Number(action.slice(5));
      if (!Number.isFinite(page) || page < 0) {
        await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
        return true;
      }
      await ctx.answerCallbackQuery().catch(() => {});
      if (state.stage === "providers" && state.category) {
        await showProvidersStep(ctx, state, state.category, page);
      } else if (state.stage === "models" && typeof state.providerIndex === "number") {
        await showModelsStep(ctx, state, state.providerIndex, page);
      }
      return true;
    }

    if (action.startsWith("prov:")) {
      const idx = Number(action.slice(5));
      const providers = pickCategoryList(state);
      if (!Number.isFinite(idx) || idx < 0 || idx >= providers.length) {
        await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
        return true;
      }
      await ctx.answerCallbackQuery().catch(() => {});
      await showModelsStep(ctx, state, idx, 0);
      return true;
    }

    if (action.startsWith("model:")) {
      const idx = Number(action.slice(6));
      const providers = pickCategoryList(state);
      const provider = providers[state.providerIndex ?? -1];
      if (!provider || !Number.isFinite(idx) || idx < 0 || idx >= provider.models.length) {
        await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
        return true;
      }

      const model = provider.models[idx];
      await ctx.answerCallbackQuery().catch(() => {});

      if (provider.authenticated) {
        clearMenu("model_selected");
        await ctx.deleteMessage().catch(() => {});
        await commitModelSelection(ctx, {
          providerID: provider.id,
          modelID: model.id,
          variant: "default",
        });
        return true;
      }

      await handleAuthForPendingModel(ctx, state, provider, model.id);
      return true;
    }

    await ctx.answerCallbackQuery({ text: t("model.menu.error") }).catch(() => {});
    return true;
  } catch (err) {
    logger.error("[ModelHandler] Error handling callback:", err);
    clearMenu("model_callback_error");
    await ctx.answerCallbackQuery({ text: t("model.change_error_callback") }).catch(() => {});
    return true;
  }
}

/**
 * Handles a text message when the user is expected to paste an API key.
 * Returns true if the input was consumed by the model auth flow.
 */
export async function handleModelApiKeyInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) return false;

  const state = readState(interactionManager.getSnapshot());
  if (!state || state.stage !== "awaiting_api_key") return false;

  const apiKey = text.trim();
  const providerID = state.pendingProviderID;
  const modelID = state.pendingModelID;
  const promptMessageId = state.messageId;

  if (!providerID || !modelID) {
    clearMenu("model_api_key_missing_state");
    return false;
  }

  // Always delete the user's message containing the key — even on failure.
  if (ctx.chat && ctx.message?.message_id) {
    await ctx.api.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
  }

  if (!apiKey) {
    await ctx.reply(t("model.auth.api_invalid"));
    return true;
  }

  const ok = await setProviderApiKey(providerID, apiKey);

  if (ctx.chat) {
    await ctx.api.deleteMessage(ctx.chat.id, promptMessageId).catch(() => {});
  }

  if (!ok) {
    clearMenu("model_api_key_set_failed");
    await ctx.reply(t("model.auth.api_failed"));
    return true;
  }

  clearMenu("model_api_key_set_ok");

  await ctx.reply(t("model.auth.api_saved", { provider: providerID }));
  await commitModelSelection(ctx, { providerID, modelID, variant: "default" });
  return true;
}
