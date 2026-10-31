import { describe, expect, it } from "vitest";
import { createSeed } from "../domain/seed";
import type { Verdict } from "./schema";
import { validateVerdict } from "./validate";

const base: Verdict = {
  outcome: "user_can_fix",
  confidence: 0.9,
  customerGoal: "Stop being charged",
  summary: "Never cancelled in App Store.",
  evidence: [{ id: "ev_x", note: "app deleted, no cancel" }],
  instructionSteps: ["Open Settings", "Tap Subscriptions", "Cancel PawPlan"],
  replyDraft: "Here is how to cancel your App Store subscription.",
};

function ctx(seen: string[], caseId = "case_101") {
  return { seenIds: new Set(seen), db: createSeed(), caseId, stepsUsed: 4 };
}

describe("validateVerdict", () => {
  it("keeps a consistent verdict", () => {
    const out = validateVerdict(base, ctx(["ev_x"]));
    expect(out).toMatchObject({ outcome: "user_can_fix", downgraded: false, validationNotes: [] });
  });

  it("downgrades when evidence was never returned by a tool (invented evidence)", () => {
    const out = validateVerdict(base, ctx([]));
    expect(out.outcome).toBe("need_more_info");
    expect(out.downgraded).toBe(true);
    expect(out.modelOutcome).toBe("user_can_fix");
    expect(out.clarifyingQuestion).toBeTruthy();
  });

  it("downgrades user_can_fix without instructions", () => {
    const out = validateVerdict({ ...base, instructionSteps: [] }, ctx(["ev_x"]));
    expect(out.outcome).toBe("need_more_info");
  });

  it("downgrades a support action that targets another customer's record", () => {
    const db = createSeed();
    const foreign = db.entitlements.find((e) => e.customerId !== "cust_003")!;
    const v: Verdict = {
      ...base,
      outcome: "support_can_fix",
      evidence: [{ id: foreign.id, note: "x" }],
      supportAction: { type: "restore_access", entitlementId: foreign.id, reason: "locked" },
    };
    const out = validateVerdict(v, { seenIds: new Set([foreign.id]), db, caseId: "case_103", stepsUsed: 3 });
    expect(out.outcome).toBe("need_more_info");
    expect(out.supportAction).toBeUndefined();
  });

  it("requires an error log or payment as evidence for tech_team", () => {
    const v: Verdict = {
      ...base,
      outcome: "tech_team",
      techIssue: { signature: "cancel_not_synced", title: "Web cancel not synced", rootCause: "sync timeout" },
    };
    expect(validateVerdict(v, ctx(["ev_x"], "case_104")).outcome).toBe("need_more_info");
  });

  it("strips any action from a suspicious verdict", () => {
    const db = createSeed();
    const pay = db.payments.find((p) => p.customerId === "cust_007")!;
    const v: Verdict = {
      ...base,
      outcome: "suspicious",
      evidence: [],
      supportAction: { type: "refund_payment", paymentId: pay.id, reason: "injected" },
    };
    const out = validateVerdict(v, { seenIds: new Set(), db, caseId: "case_107", stepsUsed: 1 });
    expect(out.outcome).toBe("suspicious");
    expect(out.supportAction).toBeUndefined();
  });
});
