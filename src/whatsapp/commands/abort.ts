import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { assistantRunState } from "../../bot/assistant-run-state.js";
import { logger } from "../../utils/logger.js";
import { cancelPendingMenu } from "../ui/pending.js";
import type { WhatsAppCommandHandler } from "./types.js";

const ABORT_TIMEOUT_MS = 5000;

export const abortCommand: WhatsAppCommandHandler = async (ctx) => {
  // Always clear the local pending menu, even if there's no active OpenCode
  // session — /abort is the user's universal "get me out of here" lever.
  await cancelPendingMenu(ctx.jid);
  clearAllInteractionState("whatsapp_abort_command");

  const session = getCurrentSession();
  if (!session) {
    await ctx.reply("No active session.");
    return;
  }

  await ctx.reply("Aborting…");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ABORT_TIMEOUT_MS);

  try {
    const { data, error } = await opencodeClient.session.abort(
      { sessionID: session.id, directory: session.directory },
      { signal: controller.signal },
    );
    clearTimeout(timeout);

    if (error) {
      logger.warn("[WhatsApp][abort] server error", error);
      await ctx.reply("Abort request failed (the task may have already finished).");
      return;
    }

    if (data === true) {
      foregroundSessionState.markIdle(session.id);
      assistantRunState.clearRun(session.id, "whatsapp_abort_confirmed");
      await ctx.reply("✅ Stopped.");
    } else {
      await ctx.reply("Server replied without confirming the abort. The task may have just finished.");
    }
  } catch (err) {
    clearTimeout(timeout);
    if (err instanceof Error && err.name === "AbortError") {
      await ctx.reply("Abort timed out after 5s. Local streaming was stopped.");
    } else {
      logger.error("[WhatsApp][abort] unexpected", err);
      await ctx.reply("Could not contact the server. Local streaming was stopped.");
    }
  }
};
