import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// WhatsApp now uses two address modes for 1-to-1 chats:
//   "<digits>@s.whatsapp.net"  — classic phone-number JID (PN)
//   "<digits>@lid"             — Linked Identity (rolled out 2024-2025
//                                 for privacy; the digit prefix is opaque
//                                 and unrelated to the phone number)
//
// A single human user may now message the bot from either form depending
// on their account state. We accept any JID listed in WHATSAPP_ALLOWED_NUMBER
// (comma-separated) so the user can enumerate both their PN and their LID.
export function isAllowedJid(jid: string | null | undefined): boolean {
  if (!jid) return false;
  const allowed = config.whatsapp.allowedJids;
  if (!allowed || allowed.length === 0) return false;
  return allowed.includes(jid);
}

// Group / status / broadcast JIDs we never want to talk to even if they
// somehow slip past the allowlist. Bot is single-user by design.
function isUnsupportedJid(jid: string): boolean {
  return jid.endsWith("@g.us") || jid.endsWith("@broadcast") || jid === "status@broadcast";
}

// Returns true if we should silently ignore this message. Logs once per
// rejected sender at warn level so accidental reaches are visible without
// flooding the log. The hint mentions WHATSAPP_ALLOWED_NUMBER specifically
// so users hitting LID rejection know how to fix it.
const reportedSenders = new Set<string>();
export function shouldIgnoreSender(jid: string | null | undefined): boolean {
  if (isAllowedJid(jid)) return false;
  const key = jid ?? "<unknown>";
  if (!reportedSenders.has(key)) {
    reportedSenders.add(key);
    if (jid && isUnsupportedJid(jid)) {
      logger.warn(`[WhatsApp] Ignoring message from unsupported JID type: ${key}`);
    } else if (jid && jid.endsWith("@lid")) {
      logger.warn(
        `[WhatsApp] Ignoring message from non-whitelisted LID: ${key}. ` +
          `If this is your account, append it to WHATSAPP_ALLOWED_NUMBER ` +
          `(comma-separated) and restart the bot. Example: ` +
          `WHATSAPP_ALLOWED_NUMBER=573144748764,${key}`,
      );
    } else {
      logger.warn(`[WhatsApp] Ignoring message from non-whitelisted JID: ${key}`);
    }
  }
  return true;
}
