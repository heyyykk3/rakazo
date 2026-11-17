import type { AdapterContext, MemoryStore } from "@rakazo/adapter-kit";
import { grokbotEnabled } from "../grokbot-flags.js";
import { JOURNAL_PATH_PREFIX } from "../grokbot-journal-memory.js";
import type { MemoryPromptDocument } from "./memory-context.prompt.js";
import { AGENT_MEMORY_MAX_BYTES, buildAgentMemoryPrompt } from "./memory-context.prompt.js";

export async function loadAgentMemoryContext(
  memory: MemoryStore,
  botId: string,
  context: AdapterContext,
  maxBytes = AGENT_MEMORY_MAX_BYTES,
): Promise<string | undefined> {
  // Fork: journals are recalled a few lines at a time, never loaded whole. The Memory
  // screen still lists them through readAgentMemory.
  const documents = (await readAgentMemory(memory, botId, context)).filter(
    (document) => !grokbotEnabled("memory") || !document.path.startsWith(JOURNAL_PATH_PREFIX),
  );
  return buildAgentMemoryPrompt(documents, maxBytes).text;
}

/** The bot's own memory plus the user's, in the shape the prompt builder reads. */
export async function readAgentMemory(
  memory: MemoryStore,
  botId: string,
  context: AdapterContext,
): Promise<MemoryPromptDocument[]> {
  const [botMemory, userMemory] = await Promise.all([
    memory.read({ scope: "bot", botId }, context),
    memory.read({ scope: "user" }, context),
  ]);
  return [
    ...botMemory.documents.map((document) => ({ ...document, scope: "bot" as const })),
    ...userMemory.documents.map((document) => ({ ...document, scope: "user" as const })),
  ];
}
