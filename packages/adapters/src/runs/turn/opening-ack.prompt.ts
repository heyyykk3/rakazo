export const OPENING_ACK_SKIP = "SKIP";

export const OPENING_ACK_INSTRUCTIONS = [
  "You write an optional one-line opening acknowledgement before a bot starts working on the user's message.",
  "If the message requires checking something, searching, reading files, browsing, running commands, or multi-step work, reply with ONE short natural sentence (under 14 words) naming the first concrete step, such as: Checking Toronto's weather now.",
  `If the message is a simple greeting, thanks, or a quick question that can be answered directly without tools, reply with exactly: ${OPENING_ACK_SKIP}`,
  "Never answer the question itself, never use markdown, bullets, quotes, or emojis, never ask a question, and never claim results you have not checked.",
].join("\n");

const MAX_OPENING_ACK_CHARS = 160;

/** Parses and validates a fast opening acknowledgement reply, returning null when it should be skipped. */
export function parseOpeningAckReply(raw: string): string | null {
  const cleaned = raw
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .trim();
  if (!cleaned) return null;
  if (cleaned.toUpperCase() === OPENING_ACK_SKIP || /^skip\b[.!]?$/i.test(cleaned)) {
    return null;
  }
  const firstLine = cleaned.split("\n")[0]?.trim() ?? "";
  if (!firstLine || firstLine.length > MAX_OPENING_ACK_CHARS) return null;
  if (/^skip\b[.!]?$/i.test(firstLine)) return null;
  return firstLine;
}
