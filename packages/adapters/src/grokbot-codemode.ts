import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { validateToolArguments } from "@earendil-works/pi-ai";
import {
  CodemodeSandbox,
  type CodemodeTool,
  parseCodemodeSource,
  renderDeclarations,
} from "@earendil-works/pi-codemode";
import type { ConnectorTool } from "@rakazo/adapter-kit";
import { Type } from "typebox";
import { grokbotEnabled } from "./grokbot-flags.js";
import type { ToolHost } from "./pi-runtime-tools.js";

export const RUN_SCRIPT_TOOL = "run_script";

/**
 * Read-only tools a script may call. Anything that sends, posts, writes, pays or needs a card
 * stays a direct call the model makes in the open, so approvals keep working as they do today.
 */
const SCRIPT_TOOL_NAMES = new Set([
  "web_search",
  "web_fetch",
  "read_file",
  "list_files",
  "recall_memory",
  "search_history",
  "read_history",
  "skill_read",
  "schedule_list",
  "list_fleet",
]);

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;

type BuildAgentTool = (tool: ConnectorTool, host: ToolHost, name: string) => AgentTool;

/**
 * Fork: Pi codemode. One tool runs model-written JavaScript in a QuickJS sandbox whose only
 * capability is calling the read-only tools above, so a multi-site lookup costs one model turn
 * instead of one per call. Each nested call runs through the normal tool wrapper one level down,
 * like a helper's calls: same executor, gate, audit and activity, but no turn checkpoint.
 */
export function runScriptAgentTool(
  toolDefs: readonly ConnectorTool[],
  host: ToolHost,
  build: BuildAgentTool,
): AgentTool | undefined {
  if (!grokbotEnabled("codemode")) return undefined;
  const allowed = toolDefs.filter((tool) => SCRIPT_TOOL_NAMES.has(tool.name));
  if (allowed.length === 0) return undefined;
  const declarations = renderDeclarations({
    tools: allowed.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema as never,
      execute: () => undefined,
    })),
  });
  return {
    name: RUN_SCRIPT_TOOL,
    label: RUN_SCRIPT_TOOL,
    description: [
      "Run JavaScript that calls several read-only tools in one step, then report only what matters.",
      "Use it for work that would otherwise take many separate searches, fetches or file reads, such as checking several sites and comparing them.",
      "The code is the body of an async function: use await, Promise.all and return. Call tools as await tools.<name>(args); each returns the tool's result, parsed from JSON when possible.",
      "Use text(value) to add output lines. Only the output and the return value come back to you, so filter and summarize inside the script.",
      "There is no fetch, timers, require or file system; only the tools below. Sending, posting, writing and anything that needs approval stays a direct tool call.",
      "An optional first line // @options: {\"timeout_ms\": 60000} sets the deadline (max 300000).",
      "",
      declarations,
    ].join("\n"),
    parameters: Type.Object({
      code: Type.String({ description: "JavaScript source for the script body." }),
    }),
    execute: async (toolCallId, params, signal): Promise<AgentToolResult<unknown>> => {
      const source = String((params as { code?: unknown })?.code ?? "");
      let code: string;
      let timeoutMs = DEFAULT_TIMEOUT_MS;
      try {
        const parsed = parseCodemodeSource(source);
        code = parsed.code;
        if (parsed.options.timeoutMs) {
          timeoutMs = Math.min(MAX_TIMEOUT_MS, Math.max(1_000, parsed.options.timeoutMs));
        }
      } catch (error) {
        return errorResult(`Script not run: ${messageOf(error)}`);
      }
      // Script calls get their own namespace so their execution ids never collide with the
      // main agent's, and do not write turn checkpoints.
      const scriptHost: ToolHost = {
        ...host,
        providerToolCallIds: new Map(),
        captureCheckpoint: undefined,
        agentNamespace: `${host.agentNamespace ?? "main"}/script/${toolCallId}`,
        pendingShells: [],
        abortTurn: () => host.abortTurn(),
      };
      let seq = 0;
      const sandboxTools: CodemodeTool[] = allowed.map((tool) => {
        const agentTool = build(tool, scriptHost, tool.name);
        return {
          name: tool.name,
          description: tool.description,
          execute: async (args, context) => {
            const prepared = agentTool.prepareArguments?.(args ?? {}) ?? args ?? {};
            const callId = `call-${seq++}`;
            const validated = validateToolArguments(agentTool, {
              type: "toolCall",
              id: callId,
              name: tool.name,
              arguments: prepared as never,
            });
            const result = await agentTool.execute(callId, validated, context.signal);
            return scriptValue(result);
          },
        };
      });
      const sandbox = new CodemodeSandbox({ tools: sandboxTools, timeoutMs });
      try {
        const result = await sandbox.execute(code, {
          signal: signal ?? host.signal,
          timeoutMs,
        });
        const content: AgentToolResult<unknown>["content"] = [];
        for (const item of result.output) {
          if (item.type === "text") content.push({ type: "text", text: item.text });
          else content.push({ type: "image", data: item.data, mimeType: item.mimeType });
        }
        if (result.ok) {
          if (result.value !== undefined) {
            content.push({ type: "text", text: `Returned: ${stringify(result.value)}` });
          }
          if (content.length === 0) content.push({ type: "text", text: "Script finished." });
          return { content, details: { calls: result.calls.length } };
        }
        content.push({
          type: "text",
          text: `Script failed (${result.error.kind}): ${result.error.message}`,
        });
        return { content, details: { error: result.error.message, calls: result.calls.length } };
      } finally {
        await sandbox.close();
      }
    },
  };
}

/** Tool results reach the script as parsed JSON when they are JSON, else as text. */
function scriptValue(result: AgentToolResult<unknown>): unknown {
  const text = (result?.content ?? [])
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("\n");
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorResult(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details: { error: text } };
}
