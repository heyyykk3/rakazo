import type { Message } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import { compactLongLoopMessages } from "./loop-checkpoint.js";

function makeExchange(step: number, output = `output for step ${step}`): Message[] {
  const id = `call-${step}`;
  return [
    {
      role: "assistant",
      api: "openai-completions",
      provider: "test",
      model: "test-model",
      usage: {
        input: 10,
        output: 10,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 20,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "toolUse",
      timestamp: 1_000 + step,
      content: [
        {
          type: "toolCall",
          id,
          name: "web_fetch",
          arguments: { url: `https://example.test/${step}` },
        },
      ],
    },
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "web_fetch",
      content: [{ type: "text", text: output }],
      isError: false,
      timestamp: 1_000 + step,
    },
  ];
}

describe("compactLongLoopMessages", () => {
  it("leaves short tool loops untouched", () => {
    const messages: Message[] = [
      { role: "user", content: "Research pricing", timestamp: 100 },
      ...makeExchange(1),
      ...makeExchange(2),
      ...makeExchange(3),
    ];
    expect(compactLongLoopMessages(messages)).toBe(messages);
  });

  it("compacts older completed exchanges into a structured checkpoint while keeping recent exchanges intact", () => {
    const messages: Message[] = [
      { role: "user", content: "Investigate all ten sources", timestamp: 100 },
      ...Array.from({ length: 10 }, (_, i) => makeExchange(i + 1)).flat(),
    ];
    const compacted = compactLongLoopMessages(messages);
    expect(compacted).not.toBe(messages);
    // Original user prompt + 1 checkpoint summary + 4 kept exchanges (8 messages) = 10 messages
    expect(compacted).toHaveLength(10);
    expect(compacted[0]?.role).toBe("user");
    expect(compacted[1]?.role).toBe("user");
    const checkpointText =
      compacted[1]?.role === "user" && Array.isArray(compacted[1].content)
        ? compacted[1].content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
        : "";
    expect(checkpointText).toContain("6 earlier tool steps compacted");
    expect(checkpointText).toContain("web_fetch(url=https://example.test/1)");
    expect(checkpointText).toContain("web_fetch(url=https://example.test/6)");
    expect(checkpointText).not.toContain("https://example.test/7");
    const keptCall = compacted[2];
    expect(keptCall?.role).toBe("assistant");
  });
});
