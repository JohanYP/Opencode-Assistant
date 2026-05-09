import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// Baileys uses two JID formats: "<digits>@s.whatsapp.net" for individuals and
// "<digits>-<id>@g.us" for groups. We only allow the configured personal JID.
export function isAllowedJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  if (!config.whatsapp.allowedNumber) return false;
  return jid === config.whatsapp.allowedNumber;
}

// Returns true if we should silently ignore this message. Logs once per
// rejected sender at warn level so accidental reaches are visible without
// flooding the log.
const reportedSenders = new Set<string>();
export function shouldIgnoreSender(jid: string | null | undefined): boolean {
  if (isAllowedJid(jid)) return false;
  const key = jid ?? "<unknown>";
  if (!reportedSenders.has(key)) {
    reportedSenders.add(key);
    logger.warn(`[WhatsApp] Ignoring message from non-whitelisted JID: ${key}`);
  }
  return true;
}
