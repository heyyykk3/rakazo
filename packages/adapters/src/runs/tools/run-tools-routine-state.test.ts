import { describe, expect, it, vi } from "vitest";
import type { RunContext } from "../assembly/run-context.js";
import type { ToolCall } from "./run-tool-gate.js";
import { taskTools } from "./run-tools-tasks.js";

function makeRoutineCtx(initialState: unknown, secrets: string[] = ["top-secret-key"]) {
  let storedState: unknown = initialState;
  const ctx = {
    run: {
      id: "run-1",
      spaceId: "space-1",
      threadId: "thread-1",
      botId: "bot-1",
      userId: "user-1",
      trigger: "routine",
      routineId: "routine-1",
    },
    secrets,
    deps: {
      prisma: {
        routine: {
          findFirst: vi.fn(async () => ({ id: "routine-1", state: storedState })),
          updateMany: vi.fn(async ({ data }: { data: { state: unknown } }) => {
            storedState = data.state;
            return { count: 1 };
          }),
        },
      },
    },
  } as unknown as RunContext;
  return { ctx, getStored: () => storedState };
}

function makeCall(args: Record<string, unknown>): ToolCall {
  return {
    name: "routine_state_set",
    args,
    executionId: "exec-1",
    effectKey: "eff-1",
    finish: async (result: unknown) => result,
  } as unknown as ToolCall;
}

describe("routine_state_get and routine_state_set", () => {
  it("reads empty object when routine has no saved state yet", async () => {
    const { ctx } = makeRoutineCtx(null);
    await expect(taskTools.routine_state_get!(ctx, makeCall({}))).resolves.toEqual({ state: {} });
  });

  it("merges state keys, redacts secrets, and supports replace", async () => {
    const { ctx, getStored } = makeRoutineCtx({ lastEmailId: "msg-1", seen: ["a"] });
    const merged = await taskTools.routine_state_set!(
      ctx,
      makeCall({ state: { lastEmailId: "msg-2", token: "top-secret-key" } }),
    );
    expect(merged).toEqual({
      ok: true,
      state: { lastEmailId: "msg-2", seen: ["a"], token: "[redacted]" },
    });
    expect(getStored()).toEqual({ lastEmailId: "msg-2", seen: ["a"], token: "[redacted]" });

    const replaced = await taskTools.routine_state_set!(
      ctx,
      makeCall({ state: { cursor: 42 }, replace: true }),
    );
    expect(replaced).toEqual({ ok: true, state: { cursor: 42 } });
    expect(getStored()).toEqual({ cursor: 42 });
  });

  it("rejects calls outside a routine run", async () => {
    const { ctx } = makeRoutineCtx(null);
    (ctx.run as { routineId: string | null }).routineId = null;
    await expect(taskTools.routine_state_get!(ctx, makeCall({}))).resolves.toMatchObject({
      error: expect.stringContaining("routine run"),
    });
    await expect(
      taskTools.routine_state_set!(ctx, makeCall({ state: { a: 1 } })),
    ).resolves.toMatchObject({
      error: expect.stringContaining("routine run"),
    });
  });
});
