import { describe, expect, it } from "vitest";
import { AFFECTED_COUNT, createSeed } from "../domain/seed";
import { approvePending, requestAction } from "../policy/execute";
import { verifyCancellationResolved } from "../verify/verifier";
import { findCancelPropagationVictims, summarize } from "./blastRadius";

describe("blast radius", () => {
  it("finds exactly the seeded victims and none of the look-alikes", () => {
    const db = createSeed();
    const victims = findCancelPropagationVictims(db);
    expect(victims).toHaveLength(AFFECTED_COUNT);
    const ids = new Set(victims.map((v) => v.customerId));
    for (const lookalike of ["c_039", "c_043", "c_047", "c_050"]) expect(ids.has(lookalike)).toBe(false);
    expect(ids.has("c_001")).toBe(true);
  });

  it("summarizes silent victims and dispute risk", () => {
    const db = createSeed();
    const s = summarize(db, findCancelPropagationVictims(db));
    expect(s.total).toBe(38);
    expect(s.silent).toBe(36); // c_001 and c_005 have written in
    expect(s.disputeRisk).toBe(10);
  });

  it("batch remediation fixes every victim and they all verify", () => {
    const db = createSeed();
    const ids = findCancelPropagationVictims(db).map((v) => v.customerId);
    const out = requestAction(db, { kind: "batch_remediate", customerIds: ids, rootCause: "web cancel not propagated to iOS" });
    expect(out.status).toBe("pending_approval");
    if (out.status !== "pending_approval") throw new Error("unreachable");
    expect(approvePending(db, out.pendingId)).toMatchObject({ status: "executed", effect: "Remediated 38/38 customers." });
    expect(ids.every((id) => verifyCancellationResolved(db, id).resolved)).toBe(true);
    expect(findCancelPropagationVictims(db)).toHaveLength(0);
  });
});

describe("verifier", () => {
  it("fails before the fix and passes after refund + cancel", () => {
    const db = createSeed();
    expect(verifyCancellationResolved(db, "c_001").resolved).toBe(false);
    const [v] = findCancelPropagationVictims(db).filter((x) => x.customerId === "c_001");
    requestAction(db, { kind: "refund", customerId: "c_001", chargeId: v.chargeId, amountUsd: v.amountUsd, reason: "post-cancel" });
    expect(verifyCancellationResolved(db, "c_001").resolved).toBe(false); // still renewing
    requestAction(db, { kind: "cancel_subscription", customerId: "c_001", subscriptionId: v.renewedSubscriptionId });
    const after = verifyCancellationResolved(db, "c_001");
    expect(after.resolved).toBe(true);
    expect(after.checks.every((c) => c.pass)).toBe(true);
  });
});
