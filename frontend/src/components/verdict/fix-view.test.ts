import { describe, expect, it } from "vitest";

import type { FixPlan, FixRunResult, FixStep, Outcome, Verdict } from "@/api";

import {
  defaultSelection,
  fixAllowed,
  ownerLabel,
  planRows,
  runSummary,
  toggleStep,
} from "./fix-view";

const verdict = (outcome: Outcome, downgraded = false): Verdict => ({
  outcome,
  modelOutcome: outcome,
  downgraded,
  validationNotes: [],
  confidence: 0.9,
  customerGoal: "",
  summary: "",
  evidence: [],
  replyDraft: "",
  stepsUsed: 1,
  createdAt: "",
});

const auto = (
  id: string,
  actor: "customer" | "support",
  wouldBe: "executed" | "blocked" = "executed",
): FixStep => ({
  id,
  kind: "auto",
  owner: "agent",
  title: id,
  detail: "",
  tool: "restoreAccess",
  actor,
  input: {},
  rule: "-",
  wouldBe,
  previewMessage: "",
});

describe("fixAllowed (F1)", () => {
  it.each<[Outcome, boolean, boolean]>([
    ["user_can_fix", false, true],
    ["support_can_fix", false, true],
    ["support_can_fix", true, false],
    ["tech_team", false, false],
    ["need_more_info", false, false],
    ["suspicious", false, false],
  ])("%s downgraded=%s → %s", (outcome, downgraded, expected) => {
    expect(fixAllowed(verdict(outcome, downgraded))).toBe(expected);
  });
});

describe("ownerLabel", () => {
  it.each<[FixStep, string]>([
    [auto("a", "customer"), "I'll do this for the customer"],
    [auto("a", "support"), "I'll do this as support"],
    [
      { id: "m", kind: "manual", owner: "customer", title: "", detail: "" },
      "Customer",
    ],
  ])("%#", (step, label) => {
    expect(ownerLabel(step)).toBe(label);
  });
});

describe("selection", () => {
  it("checks only auto steps the gate would allow", () => {
    const plan: FixPlan = {
      id: "p",
      caseId: "c",
      problem: "",
      summary: "",
      replyBody: "",
      createdAt: "",
      steps: [
        auto("a", "customer"),
        auto("b", "support", "blocked"),
        { id: "m", kind: "manual", owner: "customer", title: "", detail: "" },
      ],
    };

    expect(defaultSelection(plan)).toEqual(["a"]);
  });

  it("toggles without mutating", () => {
    const before = ["a"];

    expect(toggleStep(before, "b")).toEqual(["a", "b"]);
    expect(toggleStep(before, "a")).toEqual([]);
    expect(before).toEqual(["a"]);
  });
});

describe("runSummary", () => {
  const base: FixRunResult = {
    planId: "p",
    status: "executed",
    steps: [{ stepId: "a", status: "executed", result: null }],
    replied: true,
    resolved: true,
  };

  it.each<[string, FixRunResult, boolean, string]>([
    ["resolved", base, true, "Fix-it ran 1 step · case resolved"],
    [
      "open",
      { ...base, resolved: false },
      true,
      "Fix-it ran 1 step · case stays open for the remaining steps",
    ],
    [
      "stopped",
      {
        ...base,
        status: "stopped",
        resolved: false,
        steps: [
          {
            stepId: "a",
            status: "blocked",
            result: { status: "blocked", message: "Nope.", rule: "P3" },
          },
        ],
      },
      false,
      "Stopped · Nope. · rule P3",
    ],
  ])("%s", (_label, result, ok, message) => {
    expect(runSummary(result)).toEqual({ ok, message });
  });
});

describe("planRows", () => {
  const manual = (id: string): FixStep => ({
    id,
    kind: "manual",
    owner: "customer",
    title: "",
    detail: "",
  });
  const plan = (steps: FixStep[]): FixPlan => ({
    id: "p",
    caseId: "c",
    problem: "",
    summary: "",
    replyBody: "hi",
    createdAt: "",
    steps,
  });
  const order = (p: FixPlan) =>
    planRows(p).map((r) => (r.kind === "reply" ? "reply" : r.step.id));

  it.each<[string, FixStep[], string[]]>([
    [
      "after the last auto step",
      [auto("a", "customer"), manual("m")],
      ["a", "reply", "m"],
    ],
    ["first when no auto step", [manual("m")], ["reply", "m"]],
    [
      "between autos and trailing manuals",
      [auto("a", "support"), manual("m1"), auto("b", "support"), manual("m2")],
      ["a", "m1", "b", "reply", "m2"],
    ],
  ])("puts the reply %s", (_label, steps, expected) => {
    expect(order(plan(steps))).toEqual(expected);
  });
});
