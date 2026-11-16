import type { PrismaClient } from "@rakazo/db";
import { grokbotEnabled } from "./grokbot-flags.js";

/** Built-in tools that send, delete or spend on the person's behalf. */
const OUTBOUND_BUILTIN_TOOLS = new Set([
  "send_email",
  "delete_email",
  "paid_request",
  "request_purchase",
  "archive_bot",
]);

/** Connector actions that speak for the person, destroy data or move money. */
const OUTBOUND_CONNECTOR_ACTION =
  /(^|[_-])(send|post|publish|reply|forward|tweet|retweet|repost|comment|message|dm|delete|remove|trash|destroy|purge|pay|purchase|charge|checkout|refund|transfer|payout|submit)([_-]|$)/i;

/**
 * Fork: whether a call must ask the person in every approval mode, Never ask included.
 * A connector action counts unless its integration declared it read-only.
 */
export function grokbotOutboundAction(input: {
  name: string;
  viaConnector: boolean;
  actionNames: readonly string[];
  readOnlyFor: (toolName: string) => boolean | undefined;
}): boolean {
  if (!grokbotEnabled("gates")) return false;
  if (!input.viaConnector) return OUTBOUND_BUILTIN_TOOLS.has(input.name);
  return input.actionNames.some(
    (action) => input.readOnlyFor(action) !== true && OUTBOUND_CONNECTOR_ACTION.test(action),
  );
}

/** How long a person's "no" holds for the same action in the same chat. */
const DENIAL_MEMORY_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Fork: whether the person already denied this exact action, with the same arguments, in an
 * earlier run of this chat. Upstream only remembers denials within one run.
 */
export async function grokbotDeniedInEarlierRun(
  prisma: Pick<PrismaClient, "externalEffect">,
  input: {
    runId: string;
    threadId: string;
    kind: string;
    args: unknown;
    argsOf: (request: unknown) => unknown;
  },
): Promise<boolean> {
  if (!grokbotEnabled("gates")) return false;
  const denied = await prisma.externalEffect.findMany({
    where: {
      kind: input.kind,
      status: "denied",
      runId: { not: input.runId },
      run: { threadId: input.threadId },
      updatedAt: { gte: new Date(Date.now() - DENIAL_MEMORY_MS) },
    },
    select: { request: true, result: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  const wanted = stableJson(input.args);
  // Refusals carry a result; only a person's deny leaves it empty.
  return denied.some(
    (effect) => effect.result == null && stableJson(input.argsOf(effect.request)) === wanted,
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
}
