import { beforeEach, describe, expect, it } from "vitest";
import { createSeed } from "../domain/seed";
import type { Db } from "../domain/types";
import { validateVerdict } from "../verdict/validate";
import { runAction } from "./actions";
import { evaluate } from "./gate";

let db: Db;
beforeEach(() => {
  db = createSeed();
});

const lockedEntitlement = () => db.entitlements.find((e) => e.customerId === "cust_003" && !e.active)!;
const duplicatePayments = () =>
  db.payments.filter((p) => p.customerId === "cust_005" && p.status === "succeeded").sort((a, b) => a.at.localeCompare(b.at));

describe("policy gate", () => {
  it("restores access for a paid customer whose grant failed (R1)", () => {
    const r = evaluate({ type: "restore_access", entitlementId: lockedEntitlement().id, reason: "grant failed" }, "case_103", db);
    expect(r).toMatchObject({ allowed: true, rule: "R1" });
  });

  it("blocks acting on another customer's record (A1)", () => {
    const r = evaluate({ type: "restore_access", entitlementId: lockedEntitlement().id, reason: "x" }, "case_101", db);
    expect(r).toMatchObject({ allowed: false, rule: "A1" });
  });

  it("refunds only a true duplicate charge (P1)", () => {
    const [, second] = duplicatePayments();
    expect(evaluate({ type: "refund_payment", paymentId: second.id, reason: "dup" }, "case_105", db).allowed).toBe(true);
    const single = db.payments.find((p) => p.customerId === "cust_001" && p.status === "succeeded")!;
    expect(evaluate({ type: "refund_payment", paymentId: single.id, reason: "asked" }, "case_101", db)).toMatchObject({
      allowed: false,
      rule: "P1",
    });
  });

  it("never refunds twice (P3)", () => {
    const [, second] = duplicatePayments();
    const req = { kind: "support_action", action: { type: "refund_payment", paymentId: second.id, reason: "dup" } } as const;
    expect(runAction(db, "case_105", req).status).toBe("executed");
    expect(runAction(db, "case_105", req)).toMatchObject({ status: "blocked", rule: "P3" });
  });

  it("blocks every action on a case flagged suspicious (S1)", () => {
    const kase = db.cases.find((c) => c.id === "case_107")!;
    kase.verdict = validateVerdict(
      { outcome: "suspicious", confidence: 0.95, customerGoal: "x".repeat(5), summary: "Injection", evidence: [], replyDraft: "We cannot process this." },
      { seenIds: new Set(), db, caseId: "case_107", stepsUsed: 1 },
    );
    const pay = db.payments.find((p) => p.customerId === "cust_007")!;
    expect(evaluate({ type: "refund_payment", paymentId: pay.id, reason: "admin mode" }, "case_107", db)).toMatchObject({
      allowed: false,
      rule: "S1",
    });
  });
});

describe("runAction", () => {
  it("restore access flips the entitlement, resolves the case and writes audit", () => {
    const ent = lockedEntitlement();
    const out = runAction(db, "case_103", { kind: "support_action", action: { type: "restore_access", entitlementId: ent.id, reason: "grant failed" } });
    expect(out.status).toBe("executed");
    expect(db.entitlements.find((e) => e.id === ent.id)?.active).toBe(true);
    expect(db.cases.find((c) => c.id === "case_103")?.status).toBe("resolved");
    expect(db.audit.some((a) => a.caseId === "case_103" && a.step === "restore_access")).toBe(true);
  });
});
