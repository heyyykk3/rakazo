import { BACKGROUND_HELPER_TRIGGER } from "@rakazo/core";
import type { PrismaClient } from "@rakazo/db";
import { Prisma } from "@rakazo/db";
import { grokbotEnabled } from "./grokbot-flags.js";
import type { RunContext } from "./runs/assembly/run-context.js";
import { refusal } from "./runs/turn/tool-refusal.js";

/** Built-in tools that send, delete or spend on the person's behalf. */
const OUTBOUND_BUILTIN_TOOLS = new Set([
  "send_email",
  "delete_email",
  "paid_request",
  "request_purchase",
  "archive_bot",
]);

/** Connector actions that speak for the person, destroy data, move money or sign them up. */
const OUTBOUND_CONNECTOR_ACTION =
  /(^|[_-])(send|post|publish|reply|forward|tweet|retweet|repost|comment|message|dm|delete|remove|trash|destroy|purge|pay|purchase|charge|checkout|refund|transfer|payout|submit|subscribe|signup|register|enroll|trial|invite)([_-]|$)/i;

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

/** Built-in tools that act in the world, which a "no" must not be routed around through. */
const ACTING_BUILTIN_TOOLS = new Set([
  "shell",
  "browser_act",
  "computer_act",
  "user_computer_shell",
  "user_computer_act",
  "message_bot",
  "message_agent",
  "handoff_to_bot",
  "spawn_bot",
  "cloud_agent_launch",
  "cloud_agent_reply",
  "service_call",
]);

/** How long after a person's "no" every acting tool in that chat asks first. */
const DENIAL_WARY_MS = 2 * 60 * 60 * 1000;
const deniedRecentlyByRun = new WeakMap<object, Promise<boolean>>();

/**
 * Fork: after the person denies something in a chat, the bot must not find another way to do
 * it. For a while, every tool that acts (shell, browser and screen actions, messages to other
 * bots and agents, and app writes) asks first.
 */
export async function grokbotWaryAfterDenial(
  prisma: Pick<PrismaClient, "externalEffect">,
  runState: object,
  input: {
    threadId: string;
    name: string;
    viaConnector: boolean;
    actionNames: readonly string[];
    readOnlyFor: (toolName: string) => boolean | undefined;
  },
): Promise<boolean> {
  if (!grokbotEnabled("gates")) return false;
  const acting = input.viaConnector
    ? input.actionNames.some((action) => input.readOnlyFor(action) !== true)
    : ACTING_BUILTIN_TOOLS.has(input.name);
  if (!acting) return false;
  let denied = deniedRecentlyByRun.get(runState);
  if (!denied) {
    denied = (async () => {
      try {
        const effect = await prisma.externalEffect.findFirst({
          where: {
            status: { in: ["denied"] },
            result: { equals: Prisma.DbNull },
            run: { threadId: input.threadId },
            updatedAt: { gte: new Date(Date.now() - DENIAL_WARY_MS) },
          },
          select: { id: true, result: true },
        });
        // Refusals carry a result; only a person's deny leaves it empty.
        return Boolean(effect) && effect?.result == null;
      } catch {
        // An extra gate: if the lookup fails, upstream's own gates still apply.
        return false;
      }
    })();
    deniedRecentlyByRun.set(runState, denied);
  }
  return denied;
}

/**
 * Fork: whether another run in this chat already waits on the person's answer to a card for
 * the same kind of action. A second card for it would only make them answer twice.
 */
export async function grokbotCardAlreadyWaiting(
  prisma: Pick<PrismaClient, "externalEffect">,
  input: { runId: string; threadId: string; kind: string },
): Promise<boolean> {
  if (!grokbotEnabled("gates")) return false;
  const waiting = await prisma.externalEffect.findFirst({
    where: {
      kind: input.kind,
      status: { in: ["intended"] },
      runId: { not: input.runId },
      run: { threadId: input.threadId, status: "waiting_input" },
      updatedAt: { gte: new Date(Date.now() - DENIAL_MEMORY_MS) },
    },
    select: { id: true, runId: true },
  });
  return Boolean(waiting) && waiting?.runId !== input.runId;
}

export async function pendingCardRefusal(
  ctx: RunContext,
  name: string,
  replayEffectToolName: string,
  effectId?: string,
) {
  const { deps, run, runId } = ctx;
  // Fork: the person is already looking at a card for this kind of action in this chat.
  if (
    effectId &&
    (await grokbotCardAlreadyWaiting(deps.prisma, {
      runId,
      threadId: ctx.thread.id,
      kind: replayEffectToolName,
    }))
  ) {
    await deps.prisma.externalEffect.updateMany({
      where: { id: effectId, status: "intended" },
      data: { status: "denied", result: { refused: "card_already_waiting" } },
    });
    return {
      result: refusal(
        "approval_already_waiting",
        "The person already has an approval card waiting in this chat for this kind of action. Don't ask again; tell them it's waiting for their answer.",
      ),
    };
  }
  // Nobody sees a background helper's thread, so a card there would wait forever.
  if (run.trigger === BACKGROUND_HELPER_TRIGGER) {
    if (effectId) {
      await deps.prisma.externalEffect.updateMany({
        where: { id: effectId, status: "intended" },
        data: { status: "denied" },
      });
    }
    return {
      result: refusal(
        "helper_cannot_ask_approval",
        `${name} needs the owner's approval, and a background helper cannot ask. Don't retry; say in your result what the bot should ask for.`,
      ),
    };
  }
}
