import { createHash } from "node:crypto";
import type {
  AdapterContext,
  MemoryStore,
  SemanticMemoryCapabilities,
  SemanticMemoryForgetRequest,
  SemanticMemoryProvider,
  SemanticMemoryRecallRequest,
  SemanticMemoryResponse,
  SemanticMemoryResult,
  SemanticMemorySaveRequest,
} from "@rakazo/adapter-kit";
import { MEMORY_REVISION_CONFLICT_ERROR } from "@rakazo/adapter-kit";

/**
 * Fork memory provider: dated journals behind the semantic memory interface.
 *
 * Four stores, all ordinary memory documents so people can read and edit them:
 * - bot profile: the bot's MEMORY.md (`remember`), always loaded by upstream;
 * - shared user profile: Space shared memory (`save_shared_memory`), always loaded by upstream;
 * - bot journal: `journal/bot.md` for one bot;
 * - shared journal: `journal/shared.md` for every bot in the Space.
 * Journals hold one dated, self-contained sentence per line, tagged with the bot that learned
 * it. They are never loaded whole: each run gets the recent entries plus the ones that match
 * its request, within a small byte budget, and recall_memory searches the rest.
 */
export const JOURNAL_PATH_PREFIX = "journal/";
const BOT_JOURNAL = `${JOURNAL_PATH_PREFIX}bot.md`;
const SHARED_JOURNAL = `${JOURNAL_PATH_PREFIX}shared.md`;

/** Bytes of journal text added to a run before the person asks for more. */
export const JOURNAL_CONTEXT_BYTES = 2048;
const RECENT_DAYS = 7;
const MAX_ENTRIES_PER_JOURNAL = 400;
const MAX_FACT_CHARS = 300;
/** At or above this similarity a new fact replaces the older one: the newest wins. */
const SUPERSEDE_SIMILARITY = 0.72;
const MATCH_SIMILARITY = 0.18;

const SHARED_PREFIX = /^\s*(shared|user|everyone)\s*:\s*/i;
const LINE = /^- (\d{4}-\d{2}-\d{2}) \| ([^|\n]{1,80}) \| (.+)$/;
const SECRET =
  /(-----BEGIN [A-Z ]*PRIVATE KEY|\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{12,}|\b(password|passwd|passcode|api[ _-]?key|secret|token|otp|pin)\b\s*(is|=|:)\s*\S{4,}|\b[A-Za-z0-9+/_-]{40,}={0,2}(?![\w/]))/i;
const STOPWORDS = new Set(
  "a an and are as at be but by for from has have i in is it its of on or that the their them they this to was were what when where which who will with you your".split(
    " ",
  ),
);

interface Entry {
  date: string;
  by: string;
  fact: string;
  store: "bot" | "shared";
}

export type BotNameLookup = (botId: string, context: AdapterContext) => Promise<string | undefined>;

export class GrokbotJournalMemory implements SemanticMemoryProvider {
  readonly connectionIdentity = "grokbot-journal-v1";

  constructor(
    private readonly store: MemoryStore,
    private readonly botName: BotNameLookup,
    private readonly now: () => Date = () => new Date(),
  ) {}

  describe() {
    return {
      id: "grokbot-journal",
      contractVersion: "1",
      adapterVersion: "0.1.0",
      capabilities: {
        recall: true,
        save: true,
        purgeHistory: true,
        sharedScope: true,
        recallEachRun: true,
      } satisfies SemanticMemoryCapabilities,
    };
  }

  async save(
    request: SemanticMemorySaveRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse> {
    const shared = SHARED_PREFIX.test(request.content);
    const fact = normalizeFact(request.content.replace(SHARED_PREFIX, ""));
    if (!fact) return { ok: false, error: "Nothing to save. Write one self-contained sentence." };
    if (SECRET.test(fact))
      return {
        ok: false,
        error:
          "That looks like a password, key or code. Secrets go in the vault with request_secret, never in memory.",
      };
    const by = cleanName((await this.botName(request.botId, context)) ?? "bot");
    const entry: Entry = { date: day(this.now()), by, fact, store: shared ? "shared" : "bot" };
    await this.edit(entry.store, request.botId, context, (entries) => {
      // Same fact again, or a newer version of it: keep one line, dated today.
      const kept = entries.filter(
        (existing) => similarity(existing.fact, fact) < SUPERSEDE_SIMILARITY,
      );
      return [...kept, entry].slice(-MAX_ENTRIES_PER_JOURNAL);
    });
    return { ok: true, value: undefined };
  }

  async recall(
    request: SemanticMemoryRecallRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<SemanticMemoryResult[]>> {
    const [own, shared] = await Promise.all([
      this.read("bot", request.botId, context),
      this.read("shared", request.botId, context),
    ]);
    const all = [...own.entries, ...shared.entries];
    const query = request.query.trim();
    const scored = all
      .map((entry) => ({ entry, score: query ? relevance(query, entry.fact) : 0 }))
      .filter((item) => item.score >= MATCH_SIMILARITY)
      .sort((a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date));
    // Substring fallback for names, codes and short queries that similarity misses.
    const matches = scored.length
      ? scored
      : all
          .filter((entry) => query && entry.fact.toLowerCase().includes(query.toLowerCase()))
          .map((entry) => ({ entry, score: 0.5 }));
    const results: SemanticMemoryResult[] = [];
    const recentSince = day(new Date(this.now().getTime() - RECENT_DAYS * 86_400_000));
    const recent = resolveConflicts(all.filter((entry) => entry.date >= recentSince));
    let budget = JOURNAL_CONTEXT_BYTES;
    const take = (lines: string[]) => {
      const out: string[] = [];
      for (const line of lines) {
        const size = Buffer.byteLength(line, "utf8") + 1;
        if (size > budget) break;
        budget -= size;
        out.push(line);
      }
      return out;
    };
    const scoreOf = new Map(matches.map((item) => [entryId(item.entry), item.score]));
    const best = resolveConflicts(matches.map((item) => item.entry)).slice(
      0,
      Math.max(1, request.limit - 1),
    );
    for (const entry of best) {
      const [line] = take([format(entry)]);
      if (!line) break;
      const id = entryId(entry);
      results.push({
        memory: line,
        score: scoreOf.get(id) ?? 0.5,
        updatedAt: entry.date,
        id,
        provenance: entry.store === "shared" ? `shared journal, from ${entry.by}` : "your journal",
      });
    }
    const matchedIds = new Set(results.map((result) => result.id));
    const recentLines = take(
      recent
        .filter((entry) => !matchedIds.has(entryId(entry)))
        .sort((a, b) => b.date.localeCompare(a.date))
        .map(format),
    );
    if (recentLines.length)
      results.push({
        memory: `Recent journal (last ${RECENT_DAYS} days):\n${recentLines.join("\n")}`,
        score: 0.1,
        provenance: "recent journal entries",
      });
    return { ok: true, value: results };
  }

  async forget(
    request: SemanticMemoryForgetRequest,
    context: AdapterContext,
  ): Promise<SemanticMemoryResponse<{ id: string; expired: boolean; reason: string | null }>> {
    const target = request.id.trim();
    const wanted = normalizeFact(target.replace(SHARED_PREFIX, "")).toLowerCase();
    let removed = false;
    for (const store of ["bot", "shared"] as const) {
      await this.edit(store, request.botId, context, (entries) => {
        const kept = entries.filter(
          (entry) => entryId(entry) !== target && entry.fact.toLowerCase() !== wanted,
        );
        if (kept.length !== entries.length) removed = true;
        return kept;
      });
    }
    return removed
      ? { ok: true, value: { id: target, expired: true, reason: request.reason ?? null } }
      : { ok: false, error: "No journal entry has that id or exact text." };
  }

  async purgeHistory(): Promise<SemanticMemoryResponse> {
    // Journals hold only what a bot chose to save, never chat history.
    return { ok: true, value: undefined };
  }

  private async read(store: "bot" | "shared", botId: string, context: AdapterContext) {
    const snapshot = await this.store.read(location(store, botId), context);
    const document = snapshot.documents[0];
    return {
      revision: document?.revision ?? 0,
      entries: parse(document?.content ?? "", store),
    };
  }

  private async edit(
    store: "bot" | "shared",
    botId: string,
    context: AdapterContext,
    change: (entries: Entry[]) => Entry[],
  ) {
    for (let attempt = 1; ; attempt += 1) {
      const current = await this.read(store, botId, context);
      const next = change(current.entries);
      const content = next.map(format).join("\n");
      if (content === current.entries.map(format).join("\n")) return;
      try {
        await this.store.commit(
          {
            ...location(store, botId),
            content: content ? `${content}\n` : "",
            expectedRevision: current.revision,
            sourceRunId: context.runId,
          },
          context,
        );
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (message !== MEMORY_REVISION_CONFLICT_ERROR || attempt >= 3) throw error;
      }
    }
  }
}

function location(store: "bot" | "shared", botId: string) {
  return store === "bot"
    ? { scope: "bot" as const, botId, path: BOT_JOURNAL }
    : { scope: "user" as const, path: SHARED_JOURNAL };
}

function parse(content: string, store: "bot" | "shared"): Entry[] {
  return content.split("\n").flatMap((line) => {
    const match = LINE.exec(line.trim());
    return match ? [{ date: match[1]!, by: match[2]!.trim(), fact: match[3]!.trim(), store }] : [];
  });
}

function format(entry: Entry): string {
  return `- ${entry.date} | ${entry.by} | ${entry.fact}`;
}

function entryId(entry: Entry): string {
  return `j_${createHash("sha256").update(`${entry.store}\n${entry.fact}`).digest("hex").slice(0, 12)}`;
}

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function cleanName(name: string): string {
  return name.replace(/[|\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40) || "bot";
}

export function normalizeFact(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim().replace(/^[-*]\s+/, "");
  return flat.length > MAX_FACT_CHARS ? `${flat.slice(0, MAX_FACT_CHARS - 3)}...` : flat;
}

/**
 * When two entries say nearly the same thing, keep one: the bot's own journal for how it does
 * its job, otherwise the newest.
 */
function resolveConflicts(entries: Entry[]): Entry[] {
  const kept: Entry[] = [];
  for (const entry of entries) {
    const clash = kept.findIndex((other) => similarity(other.fact, entry.fact) >= SUPERSEDE_SIMILARITY);
    if (clash === -1) {
      kept.push(entry);
      continue;
    }
    const other = kept[clash]!;
    const ownWins = other.store !== entry.store && /\b(i|my|me)\b/i.test(entry.fact + other.fact);
    const winner = ownWins
      ? entry.store === "bot"
        ? entry
        : other
      : entry.date >= other.date
        ? entry
        : other;
    kept[clash] = winner;
  }
  return kept;
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1 && !STOPWORDS.has(word)),
  );
}

function trigrams(text: string): Set<string> {
  const flat = ` ${text.toLowerCase().replace(/\s+/g, " ")} `;
  const grams = new Set<string>();
  for (let i = 0; i + 3 <= flat.length; i += 1) grams.add(flat.slice(i, i + 3));
  return grams;
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const item of a) if (b.has(item)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

/** Similarity of two facts: word overlap, steadied by character trigrams. */
export function similarity(a: string, b: string): number {
  return 0.6 * overlap(words(a), words(b)) + 0.4 * overlap(trigrams(a), trigrams(b));
}

/** How well a fact answers a query: the share of query words it contains, plus similarity. */
function relevance(query: string, fact: string): number {
  const wanted = words(query);
  const have = words(fact);
  let hits = 0;
  for (const word of wanted) if (have.has(word)) hits += 1;
  const keyword = wanted.size ? hits / wanted.size : 0;
  return 0.6 * keyword + 0.4 * overlap(trigrams(query), trigrams(fact));
}
