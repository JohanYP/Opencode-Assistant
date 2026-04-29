import { CommandContext, Context } from "grammy";
import { isTtsConfigured } from "../../tts/client.js";
import { isTtsEnabled, setTtsEnabled } from "../../settings/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export async function ttsCommand(ctx: CommandContext<Context>): Promise<void> {
  const enabled = !isTtsEnabled();

  if (enabled && !isTtsConfigured()) {
    // Was a silent rejection — log it so users debugging "TTS won't activate"
    // can see the reason in the logs. The user-facing reply is unchanged.
    logger.info(
      "[TTS] Toggle rejected: provider not configured (set TTS_API_URL+TTS_API_KEY, or SPEECHIFY_API_KEY, or GOOGLE_APPLICATION_CREDENTIALS)",
    );
    await ctx.reply(t("tts.not_configured"));
    return;
  }

  setTtsEnabled(enabled);
  logger.info(`[TTS] Toggle: ttsEnabled=${enabled}`);

  const message = enabled ? t("tts.enabled") : t("tts.disabled");

  await ctx.reply(message);
}
