import type { Db } from "../domain/types";
import type { SupportAction } from "../verdict/schema";

export const RULES = {
  "A1": "Actions only target records of the case's own customer.",
  "R1": "Access is restored only for a succeeded, non-refunded payment with no active entitlement.",
  "P1": "A payment is refunded only if it duplicates another succeeded payment of the same subscription within 5 minutes.",
  "P2": "Refunds above $50 are never issued by support.",
  "P3": "A payment can be refunded only once.",
  "S1": "No actions on cases flagged suspicious.",
} as const;

export type RuleId = keyof typeof RULES;

export interface GateResult {
  allowed: boolean;
  rule: RuleId;
  reason: string;
}

const MAX_REFUND_USD = 50;
const DUPLICATE_WINDOW_MS = 5 * 60_000;

const ok = (rule: RuleId): GateResult => ({ allowed: true, rule, reason: RULES[rule] });
const no = (rule: RuleId, reason?: string): GateResult => ({ allowed: false, rule, reason: reason ?? RULES[rule] });

/** Deterministic policy gate. Runs on every support action, regardless of what the AI said. */
export function evaluate(action: SupportAction, caseId: string, db: Readonly<Db>): GateResult {
  const kase = db.cases.find((c) => c.id === caseId);
  if (!kase) return no("A1", "Unknown case");
  if (kase.verdict?.outcome === "suspicious") return no("S1");
  const customerId = kase.customerId;

  if (action.type === "restore_access") {
    const ent = db.entitlements.find((e) => e.id === action.entitlementId);
    if (!ent || ent.customerId !== customerId) return no("A1");
    if (ent.active) return no("R1", "Access is already active");
    const paid = db.payments.some((p) => p.customerId === customerId && p.status === "succeeded");
    return paid ? ok("R1") : no("R1", "No succeeded payment to back this access");
  }

  const pay = db.payments.find((p) => p.id === action.paymentId);
  if (!pay || pay.customerId !== customerId) return no("A1");
  if (pay.status === "refunded") return no("P3");
  if (pay.amountUsd > MAX_REFUND_USD) return no("P2", `$${pay.amountUsd} exceeds the $${MAX_REFUND_USD} limit`);
  const t = new Date(pay.at).getTime();
  const duplicate = db.payments.some(
    (p) =>
      p.id !== pay.id &&
      p.subscriptionId === pay.subscriptionId &&
      p.status === "succeeded" &&
      Math.abs(new Date(p.at).getTime() - t) <= DUPLICATE_WINDOW_MS,
  );
  return duplicate ? ok("P1") : no("P1");
}
