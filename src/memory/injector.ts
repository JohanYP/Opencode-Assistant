import { logger } from "../utils/logger.js";
import { getDocument } from "./repositories/documents.js";
import { listSkills } from "./repositories/skills.js";
import {
  isSessionInitialized,
  markSessionInitialized,
} from "./session-tracker.js";

const MEMORY_INJECT_ENABLED = process.env.MEMORY_INJECT_ENABLED !== "false";

/**
 * Builds the FULL context block for the first message of a new session.
 * Includes: soul + agents + skills list + session summary.
 *
 * Source of truth is the SQLite memory database. The legacy markdown files
 * are imported into SQLite once at app startup (see migrate-from-files.ts);
 * after that, the markdown files are no longer read by this code path.
 *
 * memory.md (now the `facts` table) and the documents table's `context`
 * entry are intentionally not inlined — the directives below tell the
 * assistant to fetch them via tools when relevant. The session summary is
 * kept inline because it captures cross-session continuity that the model
 * benefits from seeing up front.
 */
async function buildFirstMessageContext(): Promise<string> {
  const parts: string[] = [];

  const soul = getDocument("soul");
  if (soul && soul.content.trim()) {
    parts.push(`<soul>\n${soul.content.trim()}\n</soul>`);
  }

  const agents = getDocument("agents");
  if (agents && agents.content.trim()) {
    parts.push(`<agents>\n${agents.content.trim()}\n</agents>`);
  }

  const skills = listSkills();
  if (skills.length > 0) {
    const skillLines = skills
      .map((s) => {
        if (s.description) return `- ${s.name} — ${s.description}`;
        return `- ${s.name}`;
      })
      .join("\n");
    parts.push(`<skills_available>\n${skillLines}\n</skills_available>`);
  }

  const summary = getDocument("session-summary");
  if (summary && summary.content.trim()) {
    parts.push(
      `<previous_session_summary>\n${summary.content.trim()}\n</previous_session_summary>`,
    );
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
    "5. The assistant's long-term memory facts and current project context are",
    "   maintained in a SQLite database, not inlined here. When the OpenCode runtime",
    "   provides MCP memory tools (memory_read, fact_search, fact_recent, skill_read,",
    "   etc.), use them to fetch additional context as needed instead of asking the user.",
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
  const { getSkill } = await import("./repositories/skills.js");
  return getSkill(skillName)?.content ?? "";
}
