// WhatsApp can't render inline buttons or callback queries the way Telegram
// does, so multi-option flows degrade to numbered text menus that the user
// answers by sending a digit. This module renders those menus consistently.

const NUMBER_EMOJI = [
  "1️⃣",
  "2️⃣",
  "3️⃣",
  "4️⃣",
  "5️⃣",
  "6️⃣",
  "7️⃣",
  "8️⃣",
  "9️⃣",
  "🔟",
];

export interface NumberedMenuOptions {
  title?: string;
  body?: string;
  options: string[];
  // Footer hint shown below the options. Omit to use the default localized
  // hint (caller passes the localized string when calling).
  hint?: string;
}

function emojiFor(index: number): string {
  if (index < NUMBER_EMOJI.length) return NUMBER_EMOJI[index]!;
  // Past 10 we just show plain numbers; the parser still accepts them.
  return `${index + 1}.`;
}

export function formatNumberedMenu(opts: NumberedMenuOptions): string {
  const lines: string[] = [];
  if (opts.title) {
    lines.push(`*${opts.title}*`);
  }
  if (opts.body) {
    if (lines.length > 0) lines.push("");
    lines.push(opts.body);
  }
  if (lines.length > 0) lines.push("");
  opts.options.forEach((option, index) => {
    lines.push(`${emojiFor(index)} ${option}`);
  });
  if (opts.hint) {
    lines.push("");
    lines.push(`_${opts.hint}_`);
  }
  return lines.join("\n");
}

// Parses a user reply expected to be a 1-based index. Accepts plain digits
// ("3"), digits in a sentence ("opción 3", "the 3rd one"), and the number
// emojis we render. Returns null when nothing usable is found or the index
// is outside [1..max].
const NUMBER_EMOJI_TO_DIGIT: Record<string, number> = {
  "1️⃣": 1,
  "2️⃣": 2,
  "3️⃣": 3,
  "4️⃣": 4,
  "5️⃣": 5,
  "6️⃣": 6,
  "7️⃣": 7,
  "8️⃣": 8,
  "9️⃣": 9,
  "🔟": 10,
};

export function parseNumberedReply(text: string, maxOptions: number): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  for (const [emoji, value] of Object.entries(NUMBER_EMOJI_TO_DIGIT)) {
    if (trimmed.includes(emoji)) {
      return value <= maxOptions ? value : null;
    }
  }

  // First standalone number wins. We require a word boundary on both sides
  // so "12 cosas" doesn't match as 1; the digit run must be the whole token.
  const match = trimmed.match(/(?:^|\s)(\d{1,3})(?:\s|$|[.,!?])/);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isInteger(value) || value < 1 || value > maxOptions) return null;
  return value;
}
