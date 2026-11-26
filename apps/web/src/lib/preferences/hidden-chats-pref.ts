import { readStoredString, writeStoredString } from "./stored-preference";

const STORAGE_PREFIX = "rakazo:hidden-chats:";

export function hiddenChatKey(kind: "bot" | "group", id: string): string {
  return `${kind}:${id}`;
}

export function readHiddenChats(userId: string | null | undefined): Set<string> {
  if (!userId) return new Set();
  const raw = readStoredString(`${STORAGE_PREFIX}${userId}`);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
    }
  } catch {
    /* Corrupted local preference falls back to empty. */
  }
  return new Set();
}

export function writeHiddenChats(
  userId: string | null | undefined,
  keys: ReadonlySet<string>,
): void {
  if (!userId) return;
  writeStoredString(
    `${STORAGE_PREFIX}${userId}`,
    keys.size > 0 ? JSON.stringify([...keys].sort()) : null,
  );
}
