import { describe, expect, it } from "vitest";
import {
  gradeReplyShape,
  REPLY_SHAPE_EVAL_CASES,
  REPLY_SHAPE_MAX_WORDS,
  replyWordCount,
} from "./reply-shape.js";

describe("reply-shape eval suite", () => {
  it("passes short replies under the word limit", () => {
    const results = gradeReplyShape({
      text: "I can check your calendar, manage routines, search the web, and draft messages.",
      toolNames: [],
    });
    expect(results.every((c) => c.pass)).toBe(true);
  });

  it("fails long replies over 120 words when no page was saved", () => {
    const longWall = Array.from({ length: REPLY_SHAPE_MAX_WORDS + 15 }, (_, i) => `item${i}`).join(
      " ",
    );
    const results = gradeReplyShape({ text: longWall, toolNames: [] });
    expect(results.find((c) => c.id === "concise-or-page")?.pass).toBe(false);
  });

  it("passes when save_page is used with a concise summary", () => {
    const results = gradeReplyShape({
      text: "Your morning report is ready in the Morning Report page with top priorities and schedule.",
      toolNames: ["save_page"],
    });
    expect(results.every((c) => c.pass)).toBe(true);
  });

  it("exposes capabilities and morning report eval cases", () => {
    expect(REPLY_SHAPE_EVAL_CASES.map((c) => c.id)).toEqual([
      "reply-shape-what-can-you-do",
      "reply-shape-morning-report",
    ]);
    expect(replyWordCount("   ")).toBe(0);
  });
});
