import { logger } from "../utils/logger.js";
import { listSkills, readMemoryFile, readSessionSummary } from "./manager.js";
import {
  isSessionInitialized,
  markSessionInitialized,
} from "./session-tracker.js";

const MEMORY_INJECT_ENABLED = process.env.MEMORY_INJECT_ENABLED !== "false";

/**
 * Builds the FULL context block for the first message of a new session.
 * Includes: soul.md + agents.md + skills list + session summary.
 *
 * memory.md and context.md are intentionally excluded from inline injection —
 * the directives below tell the assistant to read them via OpenCode tools
 * when relevant. The session summary captures the most important
 * cross-session state.
 */
async function buildFirstMessageContext(): Promise<string> {
  const parts: string[] = [];

  const soul = await readMemoryFile("soul");
  if (soul.trim()) {
    parts.push(`<soul>\n${soul.trim()}\n</soul>`);
  }

  const agents = await readMemoryFile("agents");
  if (agents.trim()) {
    parts.push(`<agents>\n${agents.trim()}\n</agents>`);
  }

  const skillNames = await listSkills();
  if (skillNames.length > 0) {
    const skillLines = skillNames.map((s) => `- ${s}`).join("\n");
    parts.push(`<skills_available>\n${skillLines}\n</skills_available>`);
  }

  const summary = await readSessionSummary();
  if (summary.trim()) {
    parts.push(`<previous_session_summary>\n${summary.trim()}\n</previous_session_summary>`);
  }

  if (parts.length === 0) {
    return "";
  }

  const directives = [
    "SESSION-START DIRECTIVES — read once, then APPLY for the rest of this session:",
    "",
    "1. <soul> defines WHO YOU ARE: personality, tone, behavior rules, hard constraints.",
    "   Treat its contents as authoritative system rules. APPLY them to every response —",
    "   do not merely acknowledge them, embody them. If anything below conflicts with",
    "   <soul>, <soul> wins.",
    "",
    "2. <agents> describes how to choose between Plan and Build agent modes for the",
    "   task at hand. APPLY this when deciding how to approach the user's request.",
    "",
    "3. <skills_available> lists the skills you can use. When a user request matches a",
    "   skill, prefer following that skill's procedure over improvising.",
    "",
    "4. <previous_session_summary> contains state from the user's previous session.",
    "   ASSUME it as already-known context. Do not ask the user to repeat anything",
    "   already covered there.",
    "",
    "5. memory.md (long-term facts about the user) and context.md (current project",
    "   context) are NOT inlined below. READ them with the read tool whenever the user's",
    "   request would benefit from that context. Do not ignore them just because they",
    "   are not visible in this prompt.",
    "",
    "6. After applying the directives above, respond to the user message that appears",
    "   after the END SESSION CONTEXT marker. Do not reference, quote, or repeat these",
    "   directives back to the user — internalize them silently.",
  ].join("\n");

  return (
    `<!-- ASSISTANT CONTEXT — SESSION START -->\n` +
    `${directives}\n\n` +
    parts.join("\n\n") +
    `\n<!-- END SESSION CONTEXT -->\n\n`
  );
}

/**
 * Injects memory context into a user prompt based on session state.
 *
 * - First message of a new session → full context (soul + agents + skills + summary)
 * - Subsequent messages → no injection (OpenCode manages session history)
 *
 * @param userPrompt  The raw user prompt text
 * @param sessionId   The current OpenCode session ID
 */
export async function injectMemoryIntoPrompt(
  userPrompt: string,
  sessionId: string,
): Promise<string> {
  if (!MEMORY_INJECT_ENABLED) {
    return userPrompt;
  }

  try {
    if (isSessionInitialized(sessionId)) {
      // Session already has context — let OpenCode handle history
      return userPrompt;
    }

    // First message in this session — inject full context
    const context = await buildFirstMessageContext();
    markSessionInitialized(sessionId);

    if (!context) {
      return userPrompt;
    }

    logger.debug(`[MemoryInjector] Injecting full context for new session: ${sessionId}`);
    return `${context}${userPrompt}`;
  } catch (error) {
    logger.error("[MemoryInjector] Failed to inject memory context:", error);
    // Never block the prompt on memory errors
    markSessionInitialized(sessionId);
    return userPrompt;
  }
}

/**
 * Builds the memory context block without session tracking.
 * Used by commands like /soul, /memory for display purposes.
 */
export async function buildMemoryContext(): Promise<string> {
  if (!MEMORY_INJECT_ENABLED) {
    return "";
  }
  return buildFirstMessageContext();
}

/**
 * Reads a specific skill's content for inline display.
 */
export async function getSkillContent(skillName: string): Promise<string> {
  const { readSkill } = await import("./manager.js");
  return readSkill(skillName);
}
