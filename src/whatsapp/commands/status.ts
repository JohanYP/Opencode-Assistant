import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { getCurrentProject } from "../../settings/manager.js";
import { fetchCurrentAgent } from "../../agent/manager.js";
import { getAgentDisplayName } from "../../agent/types.js";
import { fetchCurrentModel } from "../../model/manager.js";
import { logger } from "../../utils/logger.js";
import type { WhatsAppCommandHandler } from "./types.js";

export const statusCommand: WhatsAppCommandHandler = async (ctx) => {
  try {
    const { data, error } = await opencodeClient.global.health();

    if (error || !data) {
      await ctx.reply("⚠️ Server unavailable.");
      return;
    }

    const lines: string[] = [];
    lines.push("*Opencode-Assistant status*");
    lines.push("");
    lines.push(`Health: ${data.healthy ? "✅ healthy" : "⚠️ unhealthy"}`);
    if (data.version) {
      lines.push(`Version: ${data.version}`);
    }

    try {
      const agent = await fetchCurrentAgent();
      if (agent) {
        lines.push(`Agent: ${getAgentDisplayName(agent)}`);
      }
    } catch (err) {
      logger.debug("[WhatsApp][status] agent fetch failed", err);
    }

    try {
      const model = fetchCurrentModel();
      lines.push(`Model: ${model.providerID}/${model.modelID}`);
    } catch (err) {
      logger.debug("[WhatsApp][status] model fetch failed", err);
    }

    const project = getCurrentProject();
    if (project) {
      lines.push(`Project: ${project.worktree}`);
    } else {
      lines.push("Project: _not selected_");
    }

    const session = getCurrentSession();
    if (session) {
      lines.push(`Session: ${session.title}`);
    } else {
      lines.push("Session: _none active_ (use /new)");
    }

    await ctx.reply(lines.join("\n"));
  } catch (err) {
    logger.error("[WhatsApp][status] error", err);
    await ctx.reply("Could not fetch server status.");
  }
};
