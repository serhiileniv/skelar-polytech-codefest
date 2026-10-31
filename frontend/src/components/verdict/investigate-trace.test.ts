import { describe, expect, it } from "vitest";

import type { InvestigateEvent, Verdict } from "@/api";

import {
  INITIAL_TRACE,
  groupSteps,
  traceReducer,
  type TraceAction,
  type TraceState,
} from "./investigate-trace";

const run = (actions: TraceAction[], from: TraceState = INITIAL_TRACE) =>
  actions.reduce(traceReducer, from);

const call = (callId: string): InvestigateEvent => ({
  event: "tool_call",
  data: { callId, tool: "getChat", input: {} },
});
const result = (callId: string, output: unknown): InvestigateEvent => ({
  event: "tool_result",
  data: { callId, tool: "getChat", output, ids: [] },
});
const text = (delta: string): InvestigateEvent => ({
  event: "text",
  data: { delta },
});
const step = (n: number): InvestigateEvent => ({ event: "step", data: { n } });
const verdict = { outcome: "user_can_fix", replyDraft: "hi" } as Verdict;

describe("traceReducer", () => {
  it("marks a tool row done when its result arrives", () => {
    const s = run([call("a"), result("a", { messages: [1] })]);
    expect(s.items).toEqual([
      expect.objectContaining({
        key: "a",
        state: "output-available",
        output: { messages: [1] },
      }),
    ]);
  });

  it("keeps a tool row running until its own result arrives", () => {
    const s = run([call("a"), call("b"), result("b", [])]);
    expect(s.items.map((i) => (i.kind === "tool" ? i.state : null))).toEqual([
      "input-available",
      "output-available",
    ]);
  });

  it.each([
    [true, "replay"],
    [false, "live"],
  ])("sets replay=%s from start (%s)", (replay) => {
    const s = run([
      {
        event: "start",
        data: { caseId: "c", replay, model: "m", maxSteps: 8 },
      },
    ]);
    expect(s.replay).toBe(replay);
  });

  it("keeps the step budget from start, defaulting to 8", () => {
    expect(INITIAL_TRACE.maxSteps).toBe(8);
    const s = run([
      {
        event: "start",
        data: { caseId: "c", replay: false, model: "m", maxSteps: 6 },
      },
    ]);
    expect(s.maxSteps).toBe(6);
  });

  it("merges text deltas within a step and splits across steps", () => {
    const s = run([step(1), text("Hel"), text("lo"), step(2), text("Bye")]);
    expect(s.items.map((i) => (i.kind === "text" ? i.text : null))).toEqual([
      "Hello",
      "Bye",
    ]);
    expect(s.steps).toBe(2);
  });

  it("marks running rows failed and stores the message on error", () => {
    const s = run([
      call("a"),
      call("b"),
      result("a", {}),
      { event: "error", data: { code: "internal", message: "boom" } },
    ]);
    expect(s.error).toBe("boom");
    expect(s.items.map((i) => (i.kind === "tool" ? i.state : null))).toEqual([
      "output-available",
      "output-error",
    ]);
  });

  it("stores the verdict", () => {
    expect(run([{ event: "verdict", data: { verdict } }]).verdict).toBe(
      verdict,
    );
  });

  it("resets to the initial state", () => {
    expect(run([text("x"), { event: "reset" }])).toEqual(INITIAL_TRACE);
  });

  it("does not mutate the previous state", () => {
    const before = run([call("a")]);
    const snapshot = structuredClone(before);
    run([result("a", 1), text("t")], before);
    expect(before).toEqual(snapshot);
  });

  it("keeps the record ids a tool returned, so evidence chips can jump to its row", () => {
    const withIds: InvestigateEvent = {
      event: "tool_result",
      data: {
        callId: "a",
        tool: "getErrorLogs",
        output: {},
        ids: ["err_0001"],
      },
    };
    const s = run([call("a"), withIds]);
    expect(s.items[0]).toEqual(expect.objectContaining({ ids: ["err_0001"] }));
  });
});

describe("groupSteps", () => {
  it.each([
    ["no items", [], []],
    ["thought then tool", [step(1), text("look"), call("a")], [["look", "a"]]],
    ["tool without thought", [call("a")], [[undefined, "a"]]],
    [
      "trailing thought",
      [call("a"), step(2), text("done?")],
      [
        [undefined, "a"],
        ["done?", undefined],
      ],
    ],
    [
      "two thoughts before one tool",
      [step(1), text("x"), step(2), text("y"), call("a")],
      [["x\ny", "a"]],
    ],
  ] as const)("%s", (_, actions, expected) => {
    const nodes = groupSteps(run([...actions]).items);
    expect(nodes.map((n) => [n.thought, n.tool?.key])).toEqual(expected);
  });
});
