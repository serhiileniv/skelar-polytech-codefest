import { describe, expect, test } from "vitest";

import { appendDraft, insertMode } from "./suggested-reply";

describe("insertMode", () => {
  test.each([
    ["empty composer → insert directly", "", undefined, "direct"],
    ["whitespace only → insert directly", "  \n", undefined, "direct"],
    ["draft is the last suggestion → replace directly", "Hi.", "Hi.", "direct"],
    ["agent's own text → ask first", "My text", undefined, "confirm"],
    ["edited suggestion → ask first", "Hi. Edited", "Hi.", "confirm"],
  ] as const)("%s", (_name, draft, lastSuggestion, want) => {
    expect(insertMode(draft, lastSuggestion)).toBe(want);
  });
});

describe("appendDraft", () => {
  test.each([
    ["adds a blank line between", "Mine", "Hi.", "Mine\n\nHi."],
    ["trims trailing whitespace first", "Mine\n\n\n", "Hi.", "Mine\n\nHi."],
    ["empty draft → just the suggestion", "", "Hi.", "Hi."],
  ])("%s", (_name, draft, text, want) => {
    expect(appendDraft(draft, text)).toBe(want);
  });
});
