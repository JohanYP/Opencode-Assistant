import { opencodeClient } from "../../opencode/client.js";
import { setCurrentSession, type SessionInfo } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { clearAllInteractionState } from "../../interaction/cleanup.js";
import { config } from "../../config.js";
import { getDateLocale } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { formatNumberedMenu } from "../ui/menu.js";
import { registerPendingMenu } from "../ui/pending.js";
import type { WhatsAppCommandHandler } from "./types.js";

interface SessionListItem {
  id: string;
  title: string;
  time: { created: number };
}

export const sessionsCommand: WhatsAppCommandHandler = async (ctx) => {
  const project = getCurrentProject();
  if (!project) {
    await ctx.reply("No project selected. Open Telegram and pick one with /projects first.");
    return;
  }

  let sessions: SessionListItem[];
  try {
    const limit = config.bot.sessionsListLimit;
    const { data, error } = await opencodeClient.session.list({
      directory: project.worktree,
      limit,
      roots: true,
    });
    if (error || !data) throw error || new Error("No data");
    sessions = data as SessionListItem[];
  } catch (err) {
    logger.error("[WhatsApp][sessions] list failed", err);
    await ctx.reply("Could not load sessions.");
    return;
  }

  if (sessions.length === 0) {
    await ctx.reply("No sessions yet. Start one with /new.");
    return;
  }

  const dateLocale = getDateLocale();
  const labels = sessions.map((s) => {
    const date = new Date(s.time.created).toLocaleDateString(dateLocale);
    return `${s.title} _(${date})_`;
  });

  const menu = formatNumberedMenu({
    title: "Recent sessions",
    options: labels,
    hint: `Reply with a number (1-${sessions.length}) to switch. /abort to cancel.`,
  });

  await ctx.reply(menu);

  registerPendingMenu(ctx.jid, {
    optionsCount: sessions.length,
    onSelect: async (index) => {
      const picked = sessions[index - 1];
      if (!picked) return;
      try {
        const { data: session, error } = await opencodeClient.session.get({
          sessionID: picked.id,
          directory: project.worktree,
        });
        if (error || !session) throw error || new Error("Failed to load session");

        const info: SessionInfo = {
          id: session.id,
          title: session.title,
          directory: project.worktree,
        };
        setCurrentSession("whatsapp", info);
        clearAllInteractionState("whatsapp_session_switched");

        logger.info(
          `[WhatsApp][sessions] Switched to id=${session.id} title="${session.title}"`,
        );
        await ctx.reply(`✅ Switched to: *${session.title}*`);
      } catch (err) {
        logger.error("[WhatsApp][sessions] switch failed", err);
        await ctx.reply("Could not switch to that session.");
      }
    },
    onInvalid: async () => {
      await ctx.reply(
        `Please reply with a number from 1 to ${sessions.length}, or /abort to cancel.`,
      );
    },
  });
};
