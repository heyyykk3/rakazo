import { grokbotEnabled } from "@rakazo/adapters";
import { ACTIVE_RUN_STATUSES } from "@rakazo/core";
import type { Prisma } from "@rakazo/db";

/** Tools whose effect key names the work they start for another bot. */
const CHILD_WORK_TOOLS = ["message_bot", "handoff_to_bot", "spawn_bot"];
/** How far back a stop looks for the chat's own runs, and how deep it follows children. */
const STOP_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const MAX_CHILD_DEPTH = 8;

export interface ChildRun {
  id: string;
  botId: string;
  threadId: string;
}

/**
 * Fork: the active runs other bots are doing because this chat asked them to, through
 * message_bot, handoff_to_bot or spawn_bot, followed down to their own children. Each such
 * call's effect key becomes the delivered message's client nonce (or the new bot's spawn key),
 * so the chain needs no message contents, which may be encrypted.
 */
export async function grokbotChildRuns(
  tx: Prisma.TransactionClient,
  input: { spaceId: string; threadId: string },
): Promise<ChildRun[]> {
  if (!grokbotEnabled("stop")) return [];
  const roots = await tx.run.findMany({
    where: {
      spaceId: input.spaceId,
      threadId: input.threadId,
      createdAt: { gte: new Date(Date.now() - STOP_LOOKBACK_MS) },
    },
    select: { id: true },
  });
  const seen = new Set(roots.map((run) => run.id));
  const found: ChildRun[] = [];
  let frontier = [...seen];
  for (let depth = 0; depth < MAX_CHILD_DEPTH && frontier.length; depth += 1) {
    const effects = await tx.externalEffect.findMany({
      where: { runId: { in: frontier }, kind: { in: CHILD_WORK_TOOLS } },
      select: { idempotencyKey: true },
    });
    if (!effects.length) break;
    const keys = effects.map((effect) => effect.idempotencyKey);
    const [delivered, spawned] = await Promise.all([
      tx.message.findMany({
        where: {
          clientNonce: {
            in: keys.flatMap((key) => [`bot-message:${key}`, `group-handoff:${key}`]),
          },
        },
        select: { id: true },
      }),
      tx.bot.findMany({
        where: { spaceId: input.spaceId, spawnKey: { in: keys } },
        select: { id: true },
      }),
    ]);
    const or: Prisma.RunWhereInput[] = [];
    if (delivered.length) or.push({ sourceMessageId: { in: delivered.map((m) => m.id) } });
    if (spawned.length) or.push({ botId: { in: spawned.map((bot) => bot.id) } });
    if (!or.length) break;
    const runs = await tx.run.findMany({
      where: {
        spaceId: input.spaceId,
        OR: or,
        status: { in: [...ACTIVE_RUN_STATUSES] },
      },
      select: { id: true, botId: true, threadId: true },
    });
    frontier = [];
    for (const run of runs) {
      if (seen.has(run.id)) continue;
      seen.add(run.id);
      found.push(run);
      frontier.push(run.id);
    }
  }
  return found;
}
