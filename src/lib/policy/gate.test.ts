import { beforeEach, describe, expect, it } from "vitest";
import { createSeed } from "../domain/seed";
import type { Db } from "../domain/types";
import { actionSchema } from "./actions";
import { approvePending, requestAction } from "./execute";
import { evaluate } from "./gate";

let db: Db;
const strayCharge = (customerId: string) =>
  db.events.find((e) => e.customerId === customerId && e.type === "charge" && e.channel === "ios")!;

beforeEach(() => {
  db = createSeed();
});

describe("policy gate: refunds", () => {
  it("auto-refunds a charge made after the customer's cancel (§2.1)", () => {
    const charge = strayCharge("c_001");
    const r = evaluate({ kind: "refund", customerId: "c_001", chargeId: charge.id, amountUsd: 29.99, reason: "post-cancel" }, db);
    expect(r).toMatchObject({ decision: "auto", rule: "2.1" });
  });

  it("blocks the prompt-injected $500 refund (§2.3)", () => {
    const charge = strayCharge("c_005");
    const r = evaluate({ kind: "refund", customerId: "c_005", chargeId: charge.id, amountUsd: 500, reason: "admin mode" }, db);
    expect(r).toMatchObject({ decision: "block", rule: "2.3" });
  });

  it("blocks refunding more than the original charge even under the limit (§2.3)", () => {
    const charge = strayCharge("c_001");
    const r = evaluate({ kind: "refund", customerId: "c_001", chargeId: charge.id, amountUsd: 45, reason: "x".repeat(5) }, db);
    expect(r.decision).toBe("block");
  });

  it("blocks refunding another customer's charge (§1.2)", () => {
    const charge = strayCharge("c_002");
    const r = evaluate({ kind: "refund", customerId: "c_001", chargeId: charge.id, amountUsd: 29.99, reason: "steal" }, db);
    expect(r).toMatchObject({ decision: "block", rule: "1.2" });
  });

  it("blocks a double refund (§2.4)", () => {
    const charge = strayCharge("c_001");
    const action = { kind: "refund", customerId: "c_001", chargeId: charge.id, amountUsd: 29.99, reason: "post-cancel" } as const;
    expect(requestAction(db, action).status).toBe("executed");
    expect(requestAction(db, action)).toMatchObject({ status: "blocked", gate: { rule: "2.4" } });
  });

  it("needs approval for a refund not preceded by a cancel (§2.2)", () => {
    const charge = strayCharge("c_043"); // charged_before_cancel look-alike
    const r = evaluate({ kind: "refund", customerId: "c_043", chargeId: charge.id, amountUsd: 29.99, reason: "asked" }, db);
    expect(r).toMatchObject({ decision: "approve", rule: "2.2" });
  });

  it("blocks unknown customers (§1.1)", () => {
    const r = evaluate({ kind: "cancel_subscription", customerId: "c_999", subscriptionId: "x" }, db);
    expect(r).toMatchObject({ decision: "block", rule: "1.1" });
  });
});

describe("policy gate: other actions", () => {
  it("auto-cancels an active subscription the customer owns (§3.1)", () => {
    expect(evaluate({ kind: "cancel_subscription", customerId: "c_001", subscriptionId: "sub_c_001_ios" }, db).decision).toBe("auto");
  });

  it("blocks cancelling someone else's subscription (§3.2)", () => {
    expect(evaluate({ kind: "cancel_subscription", customerId: "c_001", subscriptionId: "sub_c_002_ios" }, db).decision).toBe("block");
  });

  it("goodwill: 1 month needs approval, more is blocked (§4)", () => {
    expect(evaluate({ kind: "grant_credit", customerId: "c_001", months: 1, reason: "sorry" }, db).decision).toBe("approve");
    expect(evaluate({ kind: "grant_credit", customerId: "c_001", months: 3, reason: "sorry" }, db).decision).toBe("block");
  });

  it("batch remediation always needs approval (§5.1)", () => {
    expect(evaluate({ kind: "batch_remediate", customerIds: ["c_002"], rootCause: "sync bug" }, db).decision).toBe("approve");
  });
});

describe("approval flow", () => {
  it("queues approve-level actions and executes only after approval", () => {
    const out = requestAction(db, { kind: "grant_credit", customerId: "c_001", months: 1, reason: "sorry" });
    expect(out.status).toBe("pending_approval");
    const credits = () => db.events.filter((e) => e.type === "credit").length;
    expect(credits()).toBe(0);
    if (out.status !== "pending_approval") throw new Error("unreachable");
    expect(approvePending(db, out.pendingId).status).toBe("executed");
    expect(credits()).toBe(1);
  });

  it("cannot replay an approval", () => {
    const out = requestAction(db, { kind: "grant_credit", customerId: "c_001", months: 1, reason: "sorry" });
    if (out.status !== "pending_approval") throw new Error("unreachable");
    approvePending(db, out.pendingId);
    expect(() => approvePending(db, out.pendingId)).toThrow();
  });
});

describe("action schema", () => {
  it("rejects malformed tool input", () => {
    expect(actionSchema.safeParse({ kind: "refund", customerId: "c_001", chargeId: "x", amountUsd: -5, reason: "neg" }).success).toBe(false);
    expect(actionSchema.safeParse({ kind: "delete_database" }).success).toBe(false);
  });
});
