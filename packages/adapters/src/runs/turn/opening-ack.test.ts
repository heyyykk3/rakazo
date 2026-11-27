import type { AgentRunRequest } from "@rakazo/adapter-kit";
import { describe, expect, it, vi } from "vitest";
import { startOpeningAcknowledgement } from "./opening-ack.js";
import { parseOpeningAckReply } from "./opening-ack.prompt.js";

vi.mock("../../models/model-roles.js", () => ({
  effectiveModelRole: vi.fn(async () => ({
    primary: { provider: "openai-compatible", modelId: "fast-ack-model" },
    backups: [],
    primarySource: "member",
  })),
}));

vi.mock("../lifecycle/run-progress.js", () => ({
  publishInterimMessage: vi.fn(async () => undefined),
}));

import { publishInterimMessage } from "../lifecycle/run-progress.js";

function makeFixture(
  overrides: {
    ackText?: string;
    trigger?: string;
    replyMode?: "chat" | "messages";
    openingAcknowledgement?: boolean;
    toolsCount?: number;
  } = {},
) {
  const runtimeRun = vi.fn(async function* (_req: AgentRunRequest) {
    const text = overrides.ackText ?? "Checking Toronto's weather now.";
    yield { type: "text" as const, text };
    yield { type: "done" as const, text };
  });
  const resolveConnectedModel = vi.fn(async (_scope, provider: string, modelId: string) => ({
    provider,
    id: modelId,
  }));
  const reply = {
    midTurnProgressCount: 0,
    hasStreamedText: false,
    assembled: "",
    publishedMidTurnUserMessage: false,
    openingAckOnly: false,
  };
  const hold = {
    deps: {
      openingAcknowledgement: overrides.openingAcknowledgement ?? true,
      prisma: {},
      runtime: { run: runtimeRun },
    },
    run: {
      userId: "user-1",
      spaceId: "space-1",
      trigger: overrides.trigger ?? "user",
    },
    runId: "run-1",
    secrets: ["super-secret-token"],
    takeover: { takeoverResume: undefined },
  };
  const turn = {
    saved: { turnCheckpoint: undefined },
    ctx: {
      scripted: false,
      replyMode: overrides.replyMode ?? "chat",
      allowSilentEmptyRun: false,
      groupReplyOptional: false,
      state: {
        reply,
        handedOff: false,
        approval: { pausePending: false },
        lease: { valid: true },
      },
    },
  };
  const baseRequest = {
    botId: "bot-1",
    threadId: "thread-1",
    runId: "run-1",
    prompt: "Check Toronto's weather and my calendar.",
    instructions: "Main prompt",
    history: [{ role: "user" as const, content: "Earlier message" }],
    tools: Array.from({ length: overrides.toolsCount ?? 1 }, (_, i) => ({
      name: `tool_${i}`,
      description: "Tool",
      inputSchema: { type: "object" as const, properties: {} },
    })),
    model: { provider: "openai-compatible", id: "slow-opus-model", thinkingLevel: "high" as const },
  } as unknown as AgentRunRequest;
  const runtimeContext = {
    operationId: "op-1",
    traceId: "trace-1",
    spaceId: "space-1",
    userId: "user-1",
    botId: "bot-1",
    signal: new AbortController().signal,
  };
  return {
    services: { resolveConnectedModel } as never,
    hold: hold as never,
    turn: turn as never,
    ctx: turn.ctx,
    baseRequest,
    runtimeContext,
    runtimeRun,
    reply,
  };
}

describe("parseOpeningAckReply", () => {
  it("accepts one-line acknowledgements and skips SKIP or blank responses", () => {
    expect(parseOpeningAckReply("Checking Toronto's weather now.")).toBe(
      "Checking Toronto's weather now.",
    );
    expect(parseOpeningAckReply('"Checking your calendar."')).toBe("Checking your calendar.");
    expect(parseOpeningAckReply("SKIP")).toBeNull();
    expect(parseOpeningAckReply("skip.")).toBeNull();
    expect(parseOpeningAckReply("   ")).toBeNull();
  });
});

describe("startOpeningAcknowledgement", () => {
  it("posts a fast low-thinking opening acknowledgement using the approval model role", async () => {
    vi.mocked(publishInterimMessage).mockClear();
    const f = makeFixture();
    const handle = startOpeningAcknowledgement(
      f.services,
      f.hold,
      f.turn,
      f.baseRequest,
      f.runtimeContext,
    );
    await handle.settled;
    expect(f.runtimeRun).toHaveBeenCalledOnce();
    const req = f.runtimeRun.mock.calls[0]![0];
    expect(req.tools).toEqual([]);
    expect(req.model).toMatchObject({
      provider: "openai-compatible",
      id: "fast-ack-model",
      thinkingLevel: "off",
      maxTokens: 64,
    });
    expect(publishInterimMessage).toHaveBeenCalledExactlyOnceWith(
      f.ctx,
      "Checking Toronto's weather now.",
      undefined,
      { openingAck: true },
    );
  });

  it("posts nothing when the fast model replies SKIP", async () => {
    vi.mocked(publishInterimMessage).mockClear();
    const f = makeFixture({ ackText: "SKIP" });
    const handle = startOpeningAcknowledgement(
      f.services,
      f.hold,
      f.turn,
      f.baseRequest,
      f.runtimeContext,
    );
    await handle.settled;
    expect(publishInterimMessage).not.toHaveBeenCalled();
  });

  it("does not post once aborted by main model output", async () => {
    vi.mocked(publishInterimMessage).mockClear();
    const f = makeFixture();
    const handle = startOpeningAcknowledgement(
      f.services,
      f.hold,
      f.turn,
      f.baseRequest,
      f.runtimeContext,
    );
    handle.abort();
    await handle.settled;
    expect(publishInterimMessage).not.toHaveBeenCalled();
  });

  it("skips routine runs and disabled configs without calling the runtime", async () => {
    vi.mocked(publishInterimMessage).mockClear();
    const routine = makeFixture({ trigger: "routine" });
    await startOpeningAcknowledgement(
      routine.services,
      routine.hold,
      routine.turn,
      routine.baseRequest,
      routine.runtimeContext,
    ).settled;
    expect(routine.runtimeRun).not.toHaveBeenCalled();

    const disabled = makeFixture({ openingAcknowledgement: false });
    await startOpeningAcknowledgement(
      disabled.services,
      disabled.hold,
      disabled.turn,
      disabled.baseRequest,
      disabled.runtimeContext,
    ).settled;
    expect(disabled.runtimeRun).not.toHaveBeenCalled();
  });
});
