// Extracts the assistant text from an OpenCode response. Mirrors the helper
// used by `src/scheduled-task/schedule-parser.ts` so both sync-prompt code
// paths agree on what counts as "the assistant's answer". Tool calls,
// thinking parts and ignored parts are filtered out — WhatsApp users see
// only the final spoken text.

export interface ResponsePart {
  type?: string;
  text?: string;
  ignored?: boolean;
}

export function collectResponseText(parts: ResponsePart[] | undefined | null): string {
  if (!parts) return "";
  return parts
    .filter((part) => part.type === "text" && typeof part.text === "string" && !part.ignored)
    .map((part) => part.text as string)
    .join("")
    .trim();
}
