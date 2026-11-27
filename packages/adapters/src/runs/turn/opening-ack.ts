import type { AdapterContext, AgentRunModel, AgentRunRequest } from "@rakazo/adapter-kit";
import { modelRoleConnectionId } from "@rakazo/contracts";
import { deadlineSignal, isConversationalRun, redactSecrets } from "@rakazo/core";
import { bestEffort } from "@rakazo/logging";
import { effectiveModelRole } from "../../models/model-roles.js";
import { withRuntimeCleanup } from "../../runtime/runtime-stream.js";
import type { AssembledTurn } from "../assembly/run-assembly.js";
import { runAllowsSilentEmpty } from "../assembly/run-replies.prompt.js";
import type { RunExecutorServices, RunHold } from "../lifecycle/run-attempt.js";
import { publishInterimMessage } from "../lifecycle/run-progress.js";
import { OPENING_ACK_INSTRUCTIONS, parseOpeningAckReply } from "./opening-ack.prompt.js";

const OPENING_ACK_TIMEOUT_MS = 5_000;
const OPENING_ACK_MAX_TOKENS = 64;
const OPENING_ACK_HISTORY_LIMIT = 4;
const OPENING_ACK_HISTORY_ITEM_CHARS = 240;
const OPENING_ACK_PROMPT_CHARS = 600;

export interface OpeningAckHandle {
  abort: () => void;
  settled: Promise<void>;
}

const NOOP_HANDLE: OpeningAckHandle = {
  abort: () => {},
  settled: Promise.resolve(),
};

async function resolveFastAckModel(
  services: RunExecutorServices,
  hold: RunHold,
  baseModel: AgentRunModel,
): Promise<AgentRunModel> {
  const { deps, run, secrets } = hold;
  try {
    const role = await effectiveModelRole(
      deps.prisma,
      { userId: run.userId, spaceId: run.spaceId },
      "approval",
      {},
    );
    const primary = role.primary;
    if (primary?.provider && primary.modelId) {
      const resolved = await services.resolveConnectedModel(
        { userId: run.userId, spaceId: run.spaceId },
        primary.provider,
        primary.modelId,
        (values) => secrets.push(...values),
        true,
        "off",
        modelRoleConnectionId(primary),
      );
      return { ...resolved, thinkingLevel: "off", maxTokens: OPENING_ACK_MAX_TOKENS };
    }
  } catch {
    // Fall back to the bot's own model with thinking disabled.
  }
  return { ...baseModel, thinkingLevel: "off", maxTokens: OPENING_ACK_MAX_TOKENS };
}

function compactAckHistory(history: AgentRunRequest["history"]): AgentRunRequest["history"] {
  return history
    .filter((entry) => entry.content.trim().length > 0)
    .slice(-OPENING_ACK_HISTORY_LIMIT)
    .map((entry) => ({
      role: entry.role,
      content: entry.content.trim().slice(0, OPENING_ACK_HISTORY_ITEM_CHARS),
    }));
}

/**
 * Starts a concurrent, low-thinking opening acknowledgement for a conversational chat turn so the
 * user sees a quick status bubble before a slow/high-thinking main model finishes thinking or
 * calling tools. Automatically aborts if the main model emits visible text or finishes first, and
 * never delays or fails the run.
 */
export function startOpeningAcknowledgement(
  services: RunExecutorServices,
  hold: RunHold,
  turn: AssembledTurn,
  baseRequest: AgentRunRequest,
  runtimeContext: AdapterContext,
): OpeningAckHandle {
  const { deps, run, runId } = hold;
  const { ctx } = turn;
  const { reply } = ctx.state;
  const prompt = baseRequest.prompt.trim();
  if (
    !deps.openingAcknowledgement ||
    ctx.scripted ||
    ctx.replyMode !== "chat" ||
    !isConversationalRun(run.trigger) ||
    runAllowsSilentEmpty(run.trigger) ||
    ctx.allowSilentEmptyRun ||
    ctx.groupReplyOptional ||
    hold.takeover.takeoverResume ||
    turn.saved.turnCheckpoint ||
    baseRequest.tools.length === 0 ||
    !prompt
  ) {
    return NOOP_HANDLE;
  }

  const abortController = new AbortController();
  const signal = deadlineSignal(
    OPENING_ACK_TIMEOUT_MS,
    AbortSignal.any([runtimeContext.signal, abortController.signal]),
  );

  const canStillPost = () =>
    !abortController.signal.aborted &&
    !signal.aborted &&
    reply.midTurnProgressCount === 0 &&
    !reply.hasStreamedText &&
    reply.assembled.trim().length === 0 &&
    !reply.publishedMidTurnUserMessage &&
    !ctx.state.handedOff &&
    !ctx.state.approval.pausePending &&
    ctx.state.lease.valid;

  const settled = bestEffort(
    "run.opening_acknowledgement",
    (async () => {
      if (!canStillPost()) return;
      const fastModel = await resolveFastAckModel(services, hold, baseRequest.model);
      if (!canStillPost()) return;
      const ackRequest: AgentRunRequest = {
        botId: baseRequest.botId,
        threadId: baseRequest.threadId,
        runId: `${runId}:opening-ack`,
        usageOperationKind: "setup",
        onUsage: baseRequest.onUsage,
        prompt: prompt.slice(0, OPENING_ACK_PROMPT_CHARS),
        instructions: OPENING_ACK_INSTRUCTIONS,
        history: compactAckHistory(baseRequest.history),
        tools: [],
        secrets: hold.secrets,
        model: fastModel,
      };
      let raw = "";
      const events = deps.runtime.run(ackRequest, { ...runtimeContext, signal });
      for await (const event of withRuntimeCleanup(events, abortController)) {
        if (!canStillPost()) return;
        if (event.type === "text") {
          raw += event.text;
        } else if (event.type === "done" && !raw && event.text) {
          raw = event.text;
        }
      }
      const ackText = parseOpeningAckReply(redactSecrets(raw, hold.secrets));
      if (!ackText || !canStillPost()) return;
      await publishInterimMessage(ctx, ackText, undefined, { openingAck: true });
    })(),
  ).then(() => undefined);

  return {
    abort: () => {
      if (!abortController.signal.aborted) abortController.abort();
    },
    settled,
  };
}
