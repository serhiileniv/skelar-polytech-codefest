import { describe, expect, test } from "vitest";

import type { Metrics } from "@/api";

import { metricsView } from "./metrics-view";

const base: Metrics = {
  totalCases: 7,
  investigated: 0,
  byOutcome: {
    user_can_fix: 0,
    support_can_fix: 0,
    tech_team: 0,
    need_more_info: 0,
    suspicious: 0,
  },
  keptFromTech: 0,
  downgraded: 0,
  avgSteps: 0,
  actions: { executed: 0, blocked: 0 },
  eval: null,
};

describe("metricsView", () => {
  test.each([
    {
      name: "nothing investigated shows dashes and no mix",
      input: base,
      expected: {
        investigated: "0/7",
        keptFromTech: "—",
        avgSteps: "—",
        evalAccuracy: "—",
        actions: "0 · 0 blocked",
        mixLen: 0,
      },
    },
    {
      name: "mix keeps only non-zero outcomes with shares of investigated",
      input: {
        ...base,
        investigated: 4,
        byOutcome: {
          ...base.byOutcome,
          user_can_fix: 2,
          tech_team: 1,
          suspicious: 1,
        },
        keptFromTech: 3,
        avgSteps: 4.25,
        actions: { executed: 2, blocked: 1 },
        eval: { correct: 6, total: 7, ranAt: "2026-10-31T10:00:00Z" },
      },
      expected: {
        investigated: "4/7",
        keptFromTech: "3 (75%)",
        avgSteps: "4.3",
        evalAccuracy: "6/7 (86%)",
        actions: "2 · 1 blocked",
        mixLen: 3,
      },
    },
  ])("$name", ({ input, expected }) => {
    // Act
    const v = metricsView(input);

    // Assert
    expect(v.investigated).toBe(expected.investigated);
    expect(v.keptFromTech).toBe(expected.keptFromTech);
    expect(v.avgSteps).toBe(expected.avgSteps);
    expect(v.evalAccuracy).toBe(expected.evalAccuracy);
    expect(v.actions).toBe(expected.actions);
    expect(v.mix).toHaveLength(expected.mixLen);
  });

  test("mix slices follow the fixed outcome order", () => {
    const v = metricsView({
      ...base,
      investigated: 2,
      byOutcome: { ...base.byOutcome, suspicious: 1, user_can_fix: 1 },
    });

    expect(v.mix.map((s) => [s.outcome, s.pct])).toEqual([
      ["user_can_fix", 50],
      ["suspicious", 50],
    ]);
  });
});
