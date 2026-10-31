import type { Db } from "../domain/types";
import type { Action } from "./actions";
import { MAX_AUTO_REFUND_USD, POLICY_RULES, REFUND_WINDOW_DAYS, type RuleId } from "./policy";

export type Decision = "auto" | "approve" | "block";

export interface GateResult {
  decision: Decision;
  rule: RuleId;
  reason: string;
}

const DAY_MS = 86_400_000;

function result(decision: Decision, rule: RuleId, detail?: string): GateResult {
  return { decision, rule, reason: detail ?? POLICY_RULES[rule] };
}

/**
 * Deterministic policy gate. Every write action passes here before it runs.
 * The model can propose anything; only this function decides what executes.
 */
export function evaluate(action: Action, db: Readonly<Db>): GateResult {
  if (action.kind === "batch_remediate") {
    return result("approve", "5.1");
  }

  const customer = db.customers.find((c) => c.id === action.customerId);
  if (!customer) return result("block", "1.1");

  switch (action.kind) {
    case "refund": {
      const charge = db.events.find((e) => e.id === action.chargeId && e.type === "charge");
      if (!charge || charge.customerId !== action.customerId) return result("block", "1.2");
      if (db.events.some((e) => e.type === "refund" && e.refundOf === charge.id)) {
        return result("block", "2.4");
      }
      if (action.amountUsd > MAX_AUTO_REFUND_USD || action.amountUsd > charge.amountUsd) {
        return result(
          "block",
          "2.3",
          `Requested $${action.amountUsd.toFixed(2)} vs charge $${charge.amountUsd.toFixed(2)}, limit $${MAX_AUTO_REFUND_USD}.`,
        );
      }
      const ageDays = (new Date(db.now).getTime() - new Date(charge.at).getTime()) / DAY_MS;
      if (ageDays > REFUND_WINDOW_DAYS) return result("block", "2.5");
      const cancelledBefore = db.events.some(
        (e) => e.customerId === customer.id && e.type === "cancel_request" && e.at < charge.at,
      );
      return cancelledBefore ? result("auto", "2.1") : result("approve", "2.2");
    }
    case "cancel_subscription": {
      const sub = db.subscriptions.find((s) => s.id === action.subscriptionId);
      if (!sub || sub.customerId !== customer.id || sub.status !== "active") {
        return result("block", "3.2");
      }
      return result("auto", "3.1");
    }
    case "grant_credit":
      return action.months > 1 ? result("block", "4.2") : result("approve", "4.1");
  }
}
