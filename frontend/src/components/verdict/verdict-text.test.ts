import { describe, expect, test } from "vitest";

import type { Platform, Verdict } from "@/api";

import {
  actionToastMessage,
  instructionText,
  platformLabel,
  splitRecordIds,
} from "./verdict-text";

function verdict(replyDraft: string, instructionSteps?: string[]): Verdict {
  return { replyDraft, instructionSteps } as Verdict;
}

describe("instructionText", () => {
  test.each([
    ["no steps → reply as is", verdict("Hi."), "Hi."],
    ["empty steps → reply as is", verdict("Hi.", []), "Hi."],
    [
      "steps missing from reply → appended",
      verdict("Hi.", ["Open Settings", "Tap Restore"]),
      "Hi.\n\n1. Open Settings\n2. Tap Restore",
    ],
    [
      "reply already lists steps → not duplicated",
      verdict("Hi.\n1. Open Settings\n2. Tap Restore", [
        "Open Settings",
        "Tap Restore",
      ]),
      "Hi.\n1. Open Settings\n2. Tap Restore",
    ],
    [
      "empty reply → steps only",
      verdict("", ["Open Settings"]),
      "1. Open Settings",
    ],
  ])("%s", (_name, v, want) => {
    expect(instructionText(v)).toBe(want);
  });
});

describe("actionToastMessage", () => {
  test.each([
    ["Executed.", "R2", "Executed. · rule R2"],
    ["Case marked resolved.", "-", "Case marked resolved."],
    ["Case marked resolved.", "", "Case marked resolved."],
  ])("%s / %s", (msg, rule, want) => {
    expect(actionToastMessage(msg, rule)).toBe(want);
  });
});

describe("platformLabel", () => {
  test.each<[Platform, string]>([
    ["ios", "iOS"],
    ["android", "Android"],
    ["web", "Web"],
  ])("%s → %s", (p, want) => {
    expect(platformLabel(p)).toBe(want);
  });
});

describe("splitRecordIds", () => {
  test.each([
    ["plain text stays one part", "No ids here.", [{ text: "No ids here." }]],
    [
      "ids become their own parts",
      "Sub sub_0004 failed with err_0002.",
      [
        { text: "Sub " },
        { id: "sub_0004" },
        { text: " failed with " },
        { id: "err_0002" },
        { text: "." },
      ],
    ],
    [
      "unknown prefixes and partial words are not ids",
      "foo_123 and xsub_1 stay text",
      [{ text: "foo_123 and xsub_1 stay text" }],
    ],
    ["empty string → no parts", "", []],
  ])("%s", (_name, input, expected) => {
    expect(splitRecordIds(input)).toEqual(expected);
  });
});
