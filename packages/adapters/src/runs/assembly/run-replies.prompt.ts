import type { MessageBlock, ReplyMode } from "@rakazo/contracts";
import {
  BACKGROUND_HELPER_TRIGGER,
  isBackgroundRunTrigger,
  isConversationalRun,
} from "@rakazo/core";
import { messageUserMaxLength } from "../lifecycle/user-progress.js";
import { NO_RESPONSE } from "./silent-reply.js";

export function longWorkProgressGuidance(maxLength = messageUserMaxLength()): string {
  return `Before your first tool call, call message_user with one short sentence saying what you will do first, such as "Checking your calendar for Friday." If you can answer from what you already know, answer directly instead. After that, send progress updates only when the work will take minutes (long computer tasks or multi-step jobs), at most a few brief updates at real milestones, never one per tool call and never narrating routine steps. Thinking stays private. message_user is capped at ${maxLength} characters and will be silently cut off if you exceed it: never put your final answer, a report, or any long-form deliverable in it. Always put the complete final answer in your normal reply, never split across message_user calls, and never assume a message_user update already delivered your content.`;
}

export const REPLY_SHAPE_GUIDANCE =
  "Keep a chat reply to one or two short sentences when you can, and under about 80 words. Lead with the answer. When the answer is longer than that (more than five list items, a comparison, a report, a briefing or a plan), build a page with save_page and reply with one sentence saying what it shows. Send charts with render_plot and files or pictures with attach_file instead of describing them. Call ask_user only when the person genuinely must pick between distinct options, never for routine confirmation of work they already asked for.";

export const MISSING_RESULT_FOLLOW_UP_PROMPT =
  "Write the result for the person now, in one to three short sentences.";

export const LONG_REPLY_PAGE_FOLLOW_UP_PROMPT =
  "This reply is long. Move the detail into a page with save_page and reply in one short sentence saying what the page shows.";

export function replyShapeGuidanceForOfferedTools(
  disabled?: ReadonlySet<string>,
  options?: { reactOffered?: boolean },
): string {
  const parts = [
    "Keep a chat reply to one or two short sentences when you can, and under about 80 words. Lead with the answer.",
  ];
  if (!disabled?.has("save_page")) {
    parts.push(
      "When the answer is longer than that (more than five list items, a comparison, a report, a briefing or a plan), build a page with save_page and reply with one sentence saying what it shows.",
    );
  }
  const media: string[] = [];
  if (!disabled?.has("render_plot")) media.push("charts with render_plot");
  if (!disabled?.has("attach_file")) media.push("files or pictures with attach_file");
  if (media.length > 0) {
    parts.push(`Send ${media.join(" and ")} instead of describing them.`);
  }
  if (!disabled?.has("ask_user")) {
    parts.push(
      "Call ask_user only when the person genuinely must pick between distinct options, never for routine confirmation of work they already asked for.",
    );
  }
  if (options?.reactOffered && !disabled?.has("react")) {
    parts.push("For a simple thanks or OK, use react instead of posting a filler reply.");
  }
  return parts.join(" ");
}

export function messagesModeReplyGuidance(maxLength = messageUserMaxLength()): string {
  return `Text you write while working is private and never shown to the person. To tell them anything before your final answer, such as what you are starting on, something important you found, or a question, call message_user with one or two short sentences (at most ${maxLength} characters). Your final answer, the text you write after your last tool call, is shown. Put the complete answer there, never in message_user.`;
}

export const ROUTINE_SILENT_REPLY_GUIDANCE = `If this routine's prompt, or the instructions it points to, says to stay silent when there is nothing to report, the entire final assistant reply must be exactly ${NO_RESPONSE} — no surrounding prose, no variants, no progress updates, no all-clear, and no meta note that you are staying silent. An instruction to leave the reply empty or write nothing means the same: reply ${NO_RESPONSE}. Do not call message_user unless you have something to report. Nobody is waiting on this run: call ask_user only for a real decision the person must make, never to end the turn without writing.`;

export const REACTION_SILENT_REPLY_GUIDANCE = `The user reacted with an emoji to your message. Reply only if the reaction calls for it, such as a correction after 👎, a go-ahead on something you proposed, or a question. Otherwise the entire final assistant reply must be exactly ${NO_RESPONSE}, with no message_user call.`;

export const GROUP_UNADDRESSED_REPLY_GUIDANCE = `This message went to every member of the group and names nobody. Members decide at about the same time, so do not count on seeing the others' replies. Before using any tools, decide whether it is for you. Answer when it falls within your own description, or when it asks each member to reply. Stay silent when it fits another member's description better, or when no member's description fits it and you are not the first member listed. To stay silent, the entire final assistant reply must be exactly ${NO_RESPONSE}, with no tool calls, never a dot, a placeholder or an empty message.`;

/** Runs nobody is waiting on: routines, reactions, and deliveries from outside, such as webhooks. */
export function runAllowsSilentEmpty(trigger: string): boolean {
  return (
    trigger === "reaction" ||
    trigger === "routine" ||
    trigger === "webhook" ||
    isBackgroundRunTrigger(trigger)
  );
}

/**
 * Whether text written before a tool call may become a durable mid-turn chat bubble.
 * Routine, webhook and bot-to-bot runs hold it back, using the last segment as the final reply
 * only when the model supplies none and has not explicitly chosen silence.
 * Background runs never promote it.
 */
export function runPromotesMidTurnNarration(trigger: string): boolean {
  return (
    trigger !== "routine" &&
    trigger !== "webhook" &&
    trigger !== "bot_message" &&
    !isBackgroundRunTrigger(trigger)
  );
}

export const TICKET_SILENT_REPLY_GUIDANCE =
  "Ticket work is reported on the board, not in chat. Put updates and results in ticket_comment and keep the ticket status current with ticket_update. Use the existing ask or approval mechanism when user input is needed. Leave the final reply empty.";

/**
 * Messages mode only where a person waits on the reply and the bot can message them; every
 * other run keeps chat mode. A background helper cannot message anyone: its result goes back
 * to the bot.
 */
export function runReplyMode(
  trigger: string,
  botReplyMode: string,
  disabled?: ReadonlySet<string>,
): ReplyMode {
  return botReplyMode === "messages" &&
    isConversationalRun(trigger) &&
    trigger !== "bot_message" &&
    trigger !== BACKGROUND_HELPER_TRIGGER &&
    !runAllowsSilentEmpty(trigger) &&
    !disabled?.has("message_user")
    ? "messages"
    : "chat";
}

export function runReplyGuidance(trigger: string, replyMode: ReplyMode = "chat"): string {
  if (replyMode === "messages") return messagesModeReplyGuidance();
  if (trigger === "reaction") return REACTION_SILENT_REPLY_GUIDANCE;
  if (isBackgroundRunTrigger(trigger)) return TICKET_SILENT_REPLY_GUIDANCE;
  return runAllowsSilentEmpty(trigger) ? ROUTINE_SILENT_REPLY_GUIDANCE : longWorkProgressGuidance();
}

export function replyGuidanceForOfferedTools(
  guidance: string,
  disabled?: ReadonlySet<string>,
): string | undefined {
  if (!disabled?.has("message_user")) return guidance;
  if (guidance === longWorkProgressGuidance()) {
    return "Always put the complete final answer in your normal reply.";
  }
  if (guidance === REACTION_SILENT_REPLY_GUIDANCE) {
    return guidance.replace(", with no message_user call.", ".");
  }
  if (guidance === ROUTINE_SILENT_REPLY_GUIDANCE) {
    return guidance.replace(" Do not call message_user unless you have something to report.", "");
  }
  return guidance.includes("message_user") ? undefined : guidance;
}

export const DELEGATED_EMPTY_NOTICE =
  "The delegated bot completed its turn without a written summary.";

/** Failure used when a tool-bearing turn would otherwise complete as the empty notice. */
export const TOOL_STEPS_WITHOUT_RESPONSE =
  "The model finished its tool steps without a written response.";

/** The message's text blocks joined, untrimmed. */
export function messageBlocksText(blocks: readonly MessageBlock[]): string {
  return blocks
    .filter((block): block is Extract<MessageBlock, { kind: "text" }> => block.kind === "text")
    .map((block) => block.text)
    .join("");
}

/** True when the only written completion is the empty delegated notice after tool steps. */
export function emptyDelegatedToolTurnShouldFail(blocks: MessageBlock[]): boolean {
  const text = messageBlocksText(blocks).trim();
  return text === DELEGATED_EMPTY_NOTICE && blocks.some((block) => block.kind === "steps");
}

export function completionMessageSegments(
  segments: MessageBlock[],
  options?: {
    allowSilentEmpty?: boolean;
    emptyResponseText?: string;
    suppressOutput?: boolean;
    skipEmptyFallback?: boolean;
  },
): MessageBlock[] {
  if (options?.suppressOutput) return [];
  const fallback = options?.emptyResponseText?.trim() || "done.";
  if (segments.length > 0) {
    if (
      !options?.allowSilentEmpty &&
      options?.emptyResponseText !== undefined &&
      !segments.some((segment) => segment.kind === "text" && segment.text)
    ) {
      return [...segments, { kind: "text", text: fallback }];
    }
    return segments;
  }
  if (options?.allowSilentEmpty || options?.skipEmptyFallback) return [];
  return [{ kind: "text", text: fallback }];
}

/**
 * How a message the person sends while the bot works reaches the model: it knows the message
 * came mid-task. The answer goes through message_user, because a plain-text answer ends the
 * turn and the task with it; without that tool it is only asked to take the message into account.
 */
export function midTaskMessagePrompt(text: string, canMessageUser: boolean): string {
  const next = canMessageUser
    ? "Answer it now with message_user in one or two sentences, before any other tool call, even if it is unrelated to the task. Do not fold the answer into your final reply. Then continue the task, adjusting if it changes the plan."
    : "Take it into account and continue the task.";
  return `The person sent this while you were working:\n\n${text}\n\n${next}`;
}

const MID_TASK_SOURCES = {
  member: "another member of this chat",
  messaging: "a connected chat",
  webhook: "a webhook",
  routine: "your scheduled task",
} as const;

/** A message from anyone else arrives labelled with where it came from, with no call to reply. */
export function midTaskMessageFromPrompt(
  text: string,
  origin: keyof typeof MID_TASK_SOURCES | undefined,
): string {
  return `A message arrived from ${MID_TASK_SOURCES[origin ?? "member"]} while you were working:\n\n${text}`;
}
