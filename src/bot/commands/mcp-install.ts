import { CommandContext, Context, InlineKeyboard } from "grammy";
import type { McpLocalConfig, McpRemoteConfig, McpStatus } from "@opencode-ai/sdk/v2";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentProject } from "../../settings/manager.js";
import { interactionManager } from "../../interaction/manager.js";
import type { InteractionState } from "../../interaction/types.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { downloadTelegramFile } from "../utils/file-download.js";

const MCP_INSTALL_CALLBACK_PREFIX = "mcpinstall:";
const TYPE_LOCAL_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}type:local`;
const TYPE_REMOTE_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}type:remote`;
const SCOPE_GLOBAL_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}scope:global`;
const SCOPE_PROJECT_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}scope:project`;
const CONFIRM_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}confirm`;
const CANCEL_CALLBACK = `${MCP_INSTALL_CALLBACK_PREFIX}cancel`;

const NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const URL_PATTERN = /^https?:\/\/.+/i;

type WizardStage =
  | "awaiting_name"
  | "awaiting_type"
  | "awaiting_command"
  | "awaiting_url"
  | "awaiting_env"
  | "awaiting_scope"
  | "awaiting_confirm";

type McpServerType = "local" | "remote";
type McpScope = "global" | "project";

interface WizardState {
  stage: WizardStage;
  name: string | null;
  type: McpServerType | null;
  command: string[] | null;
  url: string | null;
  environment: Record<string, string>;
  scope: McpScope | null;
  projectWorktree: string | null;
  promptMessageId: number | null;
}

const ENV_KEY_PATTERN = /^[A-Z_][A-Z0-9_]*$/;
const MAX_ENV_FILE_BYTES = 64 * 1024;
const OAUTH_HEURISTIC_PATTERNS = [
  /OAUTH/,
  /CLIENT_ID/,
  /CLIENT_SECRET/,
  /REDIRECT_URI/,
];

let wizardState: WizardState | null = null;

function startWizard(projectWorktree: string | null): WizardState {
  wizardState = {
    stage: "awaiting_name",
    name: null,
    type: null,
    command: null,
    url: null,
    environment: {},
    scope: null,
    projectWorktree,
    promptMessageId: null,
  };
  return wizardState;
}

function parseEnvLines(text: string): Record<string, string> | null {
  const env: Record<string, string> = {};
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) {
    return null;
  }
  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }
    const eqIndex = line.indexOf("=");
    if (eqIndex < 0) {
      return null;
    }
    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();
    if (!ENV_KEY_PATTERN.test(key)) {
      return null;
    }
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!value) {
      return null;
    }
    env[key] = value;
  }
  return Object.keys(env).length > 0 ? env : null;
}

interface ParsedFileResult {
  kind: "oauth" | "env";
  env: Record<string, string>;
}

function parseGoogleOAuthJson(parsed: unknown): Record<string, string> | null {
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  const inner =
    (obj.installed && typeof obj.installed === "object"
      ? (obj.installed as Record<string, unknown>)
      : null) ??
    (obj.web && typeof obj.web === "object"
      ? (obj.web as Record<string, unknown>)
      : null);
  if (!inner) {
    return null;
  }
  const clientId = inner.client_id;
  const clientSecret = inner.client_secret;
  if (typeof clientId !== "string" || !clientId) {
    return null;
  }
  const env: Record<string, string> = {
    GOOGLE_OAUTH_CLIENT_ID: clientId,
  };
  if (typeof clientSecret === "string" && clientSecret) {
    env.GOOGLE_OAUTH_CLIENT_SECRET = clientSecret;
  }
  return env;
}

function parseFlatJsonEnv(parsed: unknown): Record<string, string> | null {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!ENV_KEY_PATTERN.test(key)) {
      return null;
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      return null;
    }
    env[key] = String(value);
  }
  return Object.keys(env).length > 0 ? env : null;
}

function parseUploadedFile(content: string): ParsedFileResult | null {
  const trimmed = content.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      const oauthEnv = parseGoogleOAuthJson(parsed);
      if (oauthEnv) {
        return { kind: "oauth", env: oauthEnv };
      }
      const flatEnv = parseFlatJsonEnv(parsed);
      if (flatEnv) {
        return { kind: "env", env: flatEnv };
      }
    } catch {
      // not JSON, fall through to env parsing
    }
  }

  const env = parseEnvLines(content);
  if (env) {
    return { kind: "env", env };
  }
  return null;
}

function looksOAuthRelated(env: Record<string, string>): boolean {
  return Object.keys(env).some((key) => OAUTH_HEURISTIC_PATTERNS.some((re) => re.test(key)));
}

function clearWizard(reason: string): void {
  if (wizardState) {
    logger.debug(`[McpInstall] Clearing wizard state: ${reason}`);
  }
  wizardState = null;
}

function isMcpInstallInteraction(state: InteractionState | null): boolean {
  return state?.kind === "custom" && state.metadata.flow === "mcpinstall";
}

function clearMcpInstallInteraction(reason: string): void {
  if (isMcpInstallInteraction(interactionManager.getSnapshot())) {
    interactionManager.clear(reason);
  }
}

function buildInteractionMetadata(stage: WizardStage): Record<string, unknown> {
  return {
    flow: "mcpinstall",
    stage,
  };
}

function transitionInteraction(
  expectedInput: "text" | "callback" | "mixed",
  stage: WizardStage,
): void {
  interactionManager.transition({
    kind: "custom",
    expectedInput,
    metadata: buildInteractionMetadata(stage),
  });
}

function buildCancelKeyboard(): InlineKeyboard {
  return new InlineKeyboard().text(t("mcp.install.button.cancel"), CANCEL_CALLBACK);
}

function buildTypeKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("mcp.install.button.local"), TYPE_LOCAL_CALLBACK)
    .text(t("mcp.install.button.remote"), TYPE_REMOTE_CALLBACK)
    .row()
    .text(t("mcp.install.button.cancel"), CANCEL_CALLBACK);
}

function buildScopeKeyboard(includeProject: boolean): InlineKeyboard {
  const keyboard = new InlineKeyboard().text(
    t("mcp.install.button.global"),
    SCOPE_GLOBAL_CALLBACK,
  );
  if (includeProject) {
    keyboard.text(t("mcp.install.button.project"), SCOPE_PROJECT_CALLBACK);
  }
  keyboard.row().text(t("mcp.install.button.cancel"), CANCEL_CALLBACK);
  return keyboard;
}

function buildConfirmKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text(t("mcp.install.button.confirm"), CONFIRM_CALLBACK)
    .text(t("mcp.install.button.cancel"), CANCEL_CALLBACK);
}

function parseCommand(text: string): string[] | null {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\" && i + 1 < text.length) {
      current += text[++i];
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  if (inSingle || inDouble) {
    return null;
  }
  return tokens.length > 0 ? tokens : null;
}

function normalizeDirectoryForApi(directory: string): string {
  return directory.replace(/\\/g, "/");
}

async function isMcpNameTaken(name: string, scopeDirectory: string | undefined): Promise<boolean> {
  try {
    const { data, error } = await opencodeClient.mcp.status(
      scopeDirectory ? { directory: scopeDirectory } : {},
    );
    if (error || !data) {
      return false;
    }
    if (Array.isArray(data)) {
      return data.some((item) => (item as { name?: string }).name === name);
    }
    return Object.prototype.hasOwnProperty.call(data, name);
  } catch {
    return false;
  }
}

function getScopeLabel(scope: McpScope): string {
  return scope === "global"
    ? t("mcp.install.scope.global_label")
    : t("mcp.install.scope.project_label");
}

function buildPreviewMessage(state: WizardState): string {
  const spec =
    state.type === "local"
      ? t("mcp.install.preview.command", { command: (state.command ?? []).join(" ") })
      : t("mcp.install.preview.url", { url: state.url ?? "" });
  const envKeys = Object.keys(state.environment);
  const envBlock = envKeys.length
    ? t("mcp.install.preview.env_keys", {
        count: String(envKeys.length),
        keys: envKeys.join(", "),
      })
    : "";
  return t("mcp.install.preview", {
    name: state.name ?? "",
    type: state.type ?? "",
    scope: getScopeLabel(state.scope ?? "global"),
    spec,
    envBlock,
  });
}

function extractStatusLabel(rawStatus: unknown): string {
  if (rawStatus && typeof rawStatus === "object") {
    const status = (rawStatus as { status?: unknown }).status;
    if (typeof status === "string") {
      return status;
    }
  }
  return t("common.unknown");
}

export async function mcpCommand(ctx: CommandContext<Context>): Promise<void> {
  const currentProject = getCurrentProject();
  const projectWorktree = currentProject?.worktree ?? null;

  startWizard(projectWorktree);
  interactionManager.start({
    kind: "custom",
    expectedInput: "text",
    metadata: buildInteractionMetadata("awaiting_name"),
  });

  const message = await ctx.reply(t("mcp.install.prompt.name"), {
    reply_markup: buildCancelKeyboard(),
  });
  if (wizardState) {
    wizardState.promptMessageId = message.message_id;
  }
}

export async function handleMcpInstallCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data || !data.startsWith(MCP_INSTALL_CALLBACK_PREFIX)) {
    return false;
  }

  if (!wizardState || !isMcpInstallInteraction(interactionManager.getSnapshot())) {
    await ctx.answerCallbackQuery({
      text: t("mcp.install.inactive_callback"),
      show_alert: true,
    });
    return true;
  }

  if (data === CANCEL_CALLBACK) {
    await ctx.answerCallbackQuery({ text: t("mcp.install.cancel_callback") });
    await ctx
      .editMessageReplyMarkup({ reply_markup: undefined })
      .catch(() => {});
    clearWizard("user_cancel");
    clearMcpInstallInteraction("mcp_install_cancelled");
    await ctx.reply(t("mcp.install.cancelled"));
    return true;
  }

  if (data === TYPE_LOCAL_CALLBACK || data === TYPE_REMOTE_CALLBACK) {
    if (wizardState.stage !== "awaiting_type") {
      await ctx.answerCallbackQuery({
        text: t("mcp.install.inactive_callback"),
        show_alert: true,
      });
      return true;
    }
    wizardState.type = data === TYPE_LOCAL_CALLBACK ? "local" : "remote";
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    const promptKey =
      wizardState.type === "local" ? "mcp.install.prompt.command" : "mcp.install.prompt.url";
    wizardState.stage = wizardState.type === "local" ? "awaiting_command" : "awaiting_url";
    transitionInteraction("text", wizardState.stage);
    const message = await ctx.reply(t(promptKey), { reply_markup: buildCancelKeyboard() });
    wizardState.promptMessageId = message.message_id;
    return true;
  }

  if (data === SCOPE_GLOBAL_CALLBACK || data === SCOPE_PROJECT_CALLBACK) {
    if (wizardState.stage !== "awaiting_scope") {
      await ctx.answerCallbackQuery({
        text: t("mcp.install.inactive_callback"),
        show_alert: true,
      });
      return true;
    }
    if (data === SCOPE_PROJECT_CALLBACK && !wizardState.projectWorktree) {
      await ctx.answerCallbackQuery({
        text: t("mcp.install.project_not_selected"),
        show_alert: true,
      });
      return true;
    }
    wizardState.scope = data === SCOPE_GLOBAL_CALLBACK ? "global" : "project";
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});

    wizardState.stage = "awaiting_confirm";
    transitionInteraction("callback", "awaiting_confirm");
    const previewMessage = await ctx.reply(buildPreviewMessage(wizardState), {
      reply_markup: buildConfirmKeyboard(),
    });
    wizardState.promptMessageId = previewMessage.message_id;
    return true;
  }

  if (data === CONFIRM_CALLBACK) {
    if (wizardState.stage !== "awaiting_confirm") {
      await ctx.answerCallbackQuery({
        text: t("mcp.install.inactive_callback"),
        show_alert: true,
      });
      return true;
    }
    await ctx.answerCallbackQuery({ text: t("mcp.install.installing") });
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
    await runInstall(ctx);
    return true;
  }

  await ctx.answerCallbackQuery({
    text: t("mcp.install.inactive_callback"),
    show_alert: true,
  });
  return true;
}

export async function handleMcpInstallTextInput(ctx: Context): Promise<boolean> {
  const text = ctx.message?.text;
  if (!text || text.startsWith("/")) {
    return false;
  }
  if (!wizardState || !isMcpInstallInteraction(interactionManager.getSnapshot())) {
    return false;
  }

  if (wizardState.stage === "awaiting_name") {
    const trimmed = text.trim();
    if (!NAME_PATTERN.test(trimmed)) {
      await ctx.reply(t("mcp.install.name_invalid"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }

    const taken = await isMcpNameTaken(trimmed, undefined);
    if (taken) {
      await ctx.reply(t("mcp.install.name_taken"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }

    wizardState.name = trimmed;
    wizardState.stage = "awaiting_type";
    transitionInteraction("callback", "awaiting_type");
    const message = await ctx.reply(t("mcp.install.prompt.type"), {
      reply_markup: buildTypeKeyboard(),
    });
    wizardState.promptMessageId = message.message_id;
    return true;
  }

  if (wizardState.stage === "awaiting_command") {
    const trimmed = text.trim();
    if (!trimmed) {
      await ctx.reply(t("mcp.install.command_empty"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }
    const tokens = parseCommand(trimmed);
    if (!tokens) {
      await ctx.reply(t("mcp.install.command_empty"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }
    wizardState.command = tokens;
    await advanceToEnvStage(ctx);
    return true;
  }

  if (wizardState.stage === "awaiting_url") {
    const trimmed = text.trim();
    if (!URL_PATTERN.test(trimmed)) {
      await ctx.reply(t("mcp.install.url_invalid"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }
    wizardState.url = trimmed;
    await advanceToEnvStage(ctx);
    return true;
  }

  if (wizardState.stage === "awaiting_env") {
    const trimmed = text.trim();
    if (trimmed === "/skip") {
      await ctx.reply(t("mcp.install.env_skipped"));
      await advanceToScopeStage(ctx);
      return true;
    }
    const env = parseEnvLines(trimmed);
    if (!env) {
      await ctx.reply(t("mcp.install.env_invalid"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }
    wizardState.environment = { ...wizardState.environment, ...env };
    await advanceToScopeStage(ctx);
    return true;
  }

  return false;
}

async function advanceToEnvStage(ctx: Context): Promise<void> {
  if (!wizardState) {
    return;
  }
  wizardState.stage = "awaiting_env";
  transitionInteraction("mixed", "awaiting_env");
  const message = await ctx.reply(t("mcp.install.prompt.env"), {
    reply_markup: buildCancelKeyboard(),
  });
  wizardState.promptMessageId = message.message_id;
}

async function advanceToScopeStage(ctx: Context): Promise<void> {
  if (!wizardState) {
    return;
  }
  wizardState.stage = "awaiting_scope";
  transitionInteraction("callback", "awaiting_scope");
  const message = await ctx.reply(t("mcp.install.prompt.scope"), {
    reply_markup: buildScopeKeyboard(Boolean(wizardState.projectWorktree)),
  });
  wizardState.promptMessageId = message.message_id;
}

export async function handleMcpInstallDocument(ctx: Context): Promise<boolean> {
  if (!wizardState || !isMcpInstallInteraction(interactionManager.getSnapshot())) {
    return false;
  }
  if (wizardState.stage !== "awaiting_env") {
    return false;
  }

  const document = ctx.message?.document;
  if (!document) {
    return false;
  }

  if (typeof document.file_size === "number" && document.file_size > MAX_ENV_FILE_BYTES) {
    await ctx.reply(t("mcp.install.file_too_large"), {
      reply_markup: buildCancelKeyboard(),
    });
    return true;
  }

  let content: string;
  try {
    const downloaded = await downloadTelegramFile(ctx.api, document.file_id);
    if (downloaded.buffer.byteLength > MAX_ENV_FILE_BYTES) {
      await ctx.reply(t("mcp.install.file_too_large"), {
        reply_markup: buildCancelKeyboard(),
      });
      return true;
    }
    content = downloaded.buffer.toString("utf-8");
  } catch (error) {
    logger.warn("[McpInstall] Failed to download uploaded env file", error);
    await ctx.reply(t("mcp.install.file_download_error"), {
      reply_markup: buildCancelKeyboard(),
    });
    return true;
  }

  const parsed = parseUploadedFile(content);
  if (!parsed) {
    await ctx.reply(t("mcp.install.json_unrecognized"), {
      reply_markup: buildCancelKeyboard(),
    });
    return true;
  }

  wizardState.environment = { ...wizardState.environment, ...parsed.env };
  const keys = Object.keys(parsed.env).join(", ");
  if (parsed.kind === "oauth") {
    await ctx.reply(t("mcp.install.json_parsed_oauth", { keys }));
  } else {
    await ctx.reply(
      t("mcp.install.json_parsed_env", { count: String(Object.keys(parsed.env).length) }),
    );
  }
  await advanceToScopeStage(ctx);
  return true;
}

async function runInstall(ctx: Context): Promise<void> {
  const state = wizardState;
  if (!state || !state.name || !state.type || !state.scope) {
    clearWizard("install_invalid_state");
    clearMcpInstallInteraction("install_invalid_state");
    await ctx.reply(t("mcp.install.inactive"));
    return;
  }

  const directoryForApi =
    state.scope === "project" && state.projectWorktree
      ? normalizeDirectoryForApi(state.projectWorktree)
      : undefined;

  const hasEnv = Object.keys(state.environment).length > 0;
  const config: McpLocalConfig | McpRemoteConfig =
    state.type === "local"
      ? {
          type: "local",
          command: state.command ?? [],
          enabled: true,
          ...(hasEnv ? { environment: state.environment } : {}),
        }
      : {
          type: "remote",
          url: state.url ?? "",
          enabled: true,
          ...(hasEnv ? { headers: state.environment } : {}),
        };

  try {
    const addParams = directoryForApi
      ? { name: state.name, config, directory: directoryForApi }
      : { name: state.name, config };
    const { data: addData, error: addError } = await opencodeClient.mcp.add(addParams);

    if (addError) {
      throw addError;
    }

    let statusLabel = t("common.unknown");
    if (addData && typeof addData === "object") {
      const entry = (addData as Record<string, unknown>)[state.name];
      statusLabel = extractStatusLabel(entry);
    }

    let connectError: unknown = null;
    try {
      const connectParams = directoryForApi
        ? { name: state.name, directory: directoryForApi }
        : { name: state.name };
      const { error } = await opencodeClient.mcp.connect(connectParams);
      if (error) {
        connectError = error;
      }
    } catch (err) {
      connectError = err;
    }

    if (connectError) {
      const errorMsg = connectError instanceof Error ? connectError.message : String(connectError);
      await ctx.reply(t("mcp.install.connect_failed", { error: errorMsg }));
    } else {
      try {
        const statusParams = directoryForApi ? { directory: directoryForApi } : {};
        const { data: statusData } = await opencodeClient.mcp.status(statusParams);
        if (statusData && typeof statusData === "object") {
          const entry = (statusData as Record<string, McpStatus>)[state.name];
          if (entry) {
            statusLabel = extractStatusLabel(entry);
          }
        }
      } catch {
        // best-effort status refresh; ignore failures
      }
    }

    await ctx.reply(
      t("mcp.install.success", {
        name: state.name,
        type: state.type,
        scope: getScopeLabel(state.scope),
        status: statusLabel,
      }),
    );

    if (looksOAuthRelated(state.environment)) {
      await ctx.reply(t("mcp.install.tunnel_disclaimer"));
    }
  } catch (error) {
    logger.error("[McpInstall] Install failed", error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    await ctx.reply(t("mcp.install.error", { error: errorMsg }));
  } finally {
    clearWizard("install_finalized");
    clearMcpInstallInteraction("install_finalized");
  }
}

export function __resetMcpInstallForTests(): void {
  wizardState = null;
}
