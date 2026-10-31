import { describe, expect, it } from "vitest";

import type { Verdict } from "@/api";

import {
  awaitingAgent,
  firstPerson,
  toBubbles,
  typewriterLength,
  verdictReasons,
} from "./conversation-view";
import type { TraceItem } from "./investigate-trace";

describe("firstPerson", () => {
  it.each([
    ["Checking billing.", "I'm checking billing."],
    ["Reading the complaint.", "I'm reading the complaint."],
    ["I'll check the logs.", "I'll check the logs."],
    ["Nothing is broken.", "Nothing is broken."],
    ["  Looking up customer ", "I'm looking up customer"],
    ["Done.", "Done."],
  ])("%j → %j", (input, want) => {
    expect(firstPerson(input)).toBe(want);
  });
});

const items: TraceItem[] = [
  { kind: "text", key: "t0", step: 1, text: "Checking billing." },
  {
    kind: "tool",
    key: "c1",
    step: 1,
    name: "getBilling",
    state: "output-available",
    output: { payments: [{}, {}] },
    ids: ["pay_1", "pay_2"],
  },
  {
    kind: "tool",
    key: "c2",
    step: 2,
    name: "getErrorLogs",
    state: "input-available",
  },
];

describe("toBubbles", () => {
  it("maps steps to first-person bubbles with counted, chip-able tools", () => {
    const bubbles = toBubbles(items);

    expect(bubbles).toHaveLength(2);
    expect(bubbles[0]).toEqual({
      key: "c1",
      text: "I'm checking billing.",
      tool: {
        label: "Checked billing",
        count: "2 payments",
        ids: ["pay_1", "pay_2"],
        state: "done",
        errorText: undefined,
      },
    });
    expect(bubbles[1].tool).toMatchObject({
      label: "Reading error logs",
      state: "running",
      ids: [],
      count: null,
    });
  });

  it("drops the final submit step when it has no text", () => {
    const submit: TraceItem = {
      kind: "tool",
      key: "c9",
      step: 9,
      name: "submitVerdict",
      state: "output-available",
      ids: [],
    };
    expect(toBubbles([submit])).toEqual([]);
  });

  it("counts ids as records for tools without a noun", () => {
    const [b] = toBubbles([
      {
        kind: "tool",
        key: "c1",
        step: 1,
        name: "getCustomer",
        state: "output-available",
        output: {},
        ids: ["cust_1"],
      },
    ]);
    expect(b.tool?.count).toBe("1 record");
  });
});

describe("awaitingAgent", () => {
  it.each([
    ["not running", false, 3, false],
    ["no bubbles yet", true, 0, true],
    ["tool running", true, 3, false],
    ["between tools", true, 1, true],
  ] as const)("%s", (_, running, take, want) => {
    expect(awaitingAgent(toBubbles(items.slice(0, take)), running)).toBe(want);
  });
});

describe("verdictReasons", () => {
  const base = { summary: "S", evidence: [] } as unknown as Verdict;

  it("gives one reason per cited record", () => {
    const v = {
      ...base,
      evidence: [
        { id: "a", note: "A" },
        { id: "b", note: "B" },
      ],
    };
    expect(verdictReasons(v)).toEqual([
      { text: "A", ids: ["a"] },
      { text: "B", ids: ["b"] },
    ]);
  });

  it("falls back to the summary", () => {
    expect(verdictReasons(base)).toEqual([{ text: "S", ids: [] }]);
  });
});

describe("typewriterLength", () => {
  it.each([
    [100, 0, 0],
    [100, 500, 50],
    [100, 1000, 100],
    [100, 9999, 100],
    [3, 1, 1],
    [0, 500, 0],
  ])("%i chars at %i ms → %i", (total, elapsed, want) => {
    expect(typewriterLength(total, elapsed)).toBe(want);
  });

  it("finishes in the same time for short and long text", () => {
    expect(typewriterLength(10, 1000)).toBe(10);
    expect(typewriterLength(2000, 1000)).toBe(2000);
    expect(typewriterLength(2000, 999)).toBeLessThan(2000);
  });
});
