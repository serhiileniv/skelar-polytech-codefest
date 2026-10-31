import { describe, expect, it } from "vitest";

import type { CaseDetail, Outcome, Verdict } from "@/api";

import {
  awaitingAgent,
  currentThought,
  customerRecordIds,
  firstPerson,
  nextStepActions,
  shortGoal,
  sourcesChecked,
  toBubbles,
  typewriterLength,
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
        label: "Billing",
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

describe("sourcesChecked", () => {
  it("counts finished read tools only", () => {
    const submit: TraceItem = {
      kind: "tool",
      key: "c9",
      step: 9,
      name: "submitVerdict",
      state: "output-available",
    };
    expect(sourcesChecked([...items, submit])).toBe(1);
  });
});

describe("currentThought", () => {
  it.each([
    ["not running", false, 3, { key: null, text: null }],
    ["tool running without a thought", true, 3, { key: "c2", text: null }],
    ["between tools", true, 2, { key: null, text: null }],
  ] as const)("%s", (_, running, take, want) => {
    expect(currentThought(toBubbles(items.slice(0, take)), running)).toEqual(
      want,
    );
  });

  it("puts the thought under the running step", () => {
    const live: TraceItem[] = [
      { kind: "text", key: "t1", step: 1, text: "Checking logs." },
      { ...items[2], key: "c3" },
    ];
    expect(currentThought(toBubbles(live), true)).toEqual({
      key: "c3",
      text: "I'm checking logs.",
    });
  });

  it("shows a trailing thought while the agent is between tools", () => {
    const live: TraceItem[] = [
      ...items.slice(0, 2),
      { kind: "text", key: "t2", step: 2, text: "I'll read the logs." },
    ];
    expect(currentThought(toBubbles(live), true)).toEqual({
      key: null,
      text: "I'll read the logs.",
    });
  });
});

const verdictOf = (outcome: Outcome, extra: Partial<Verdict> = {}): Verdict =>
  ({
    outcome,
    downgraded: false,
    replyDraft: "Hi",
    customerGoal: "",
    supportAction: { type: "refund_payment", paymentId: "pay_1", reason: "r" },
    ...extra,
  }) as Verdict;

describe("nextStepActions", () => {
  it.each([
    ["support_can_fix", {}, "fix", ["support_action"], true],
    ["support_can_fix", { downgraded: true }, "support_action", [], true],
    ["support_can_fix", { supportAction: undefined }, "fix", [], true],
    ["user_can_fix", {}, "fix", ["insert_instruction"], true],
    ["user_can_fix", { downgraded: true }, "insert_instruction", [], true],
    ["tech_team", {}, "send_to_tech", [], true],
    ["need_more_info", {}, "ask_clarifying", [], false],
    ["suspicious", {}, null, [], true],
    ["suspicious", { replyDraft: " " }, null, [], false],
  ] as const)("%s %j → %s", (outcome, extra, primary, other, reply) => {
    expect(nextStepActions(verdictOf(outcome, extra))).toEqual({
      primary,
      other,
      reply,
    });
  });
});

describe("shortGoal", () => {
  it.each([
    ["", null],
    ["  Get Premium back  ", "Get Premium back"],
    ["x".repeat(71), null],
  ])("%j → %j", (goal, want) => {
    expect(shortGoal(verdictOf("tech_team", { customerGoal: goal }))).toBe(
      want,
    );
  });
});

describe("customerRecordIds", () => {
  it("collects customer, subscription, payment and entitlement ids", () => {
    const detail = {
      customer: { id: "cust_1" },
      subscriptions: [{ id: "sub_1" }],
      payments: [{ id: "pay_1" }, { id: "pay_2" }],
      entitlements: [{ id: "ent_1" }],
    } as unknown as CaseDetail;
    expect([...customerRecordIds(detail)].sort()).toEqual([
      "cust_1",
      "ent_1",
      "pay_1",
      "pay_2",
      "sub_1",
    ]);
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
