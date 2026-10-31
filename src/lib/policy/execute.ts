import type { Db, PendingAction } from "../domain/types";
import { findCancelPropagationVictims } from "../insights/blastRadius";
import type { Action } from "./actions";
import { evaluate, type GateResult } from "./gate";

export type ActionOutcome =
  | { status: "executed"; gate: GateResult; effect: string }
  | { status: "pending_approval"; gate: GateResult; pendingId: string }
  | { status: "blocked"; gate: GateResult };

let seq = 0;
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(++seq).toString(36)}`;

/** Applies an already-authorized action to the DB. Never call without a gate decision. */
function apply(db: Db, action: Action): string {
  switch (action.kind) {
    case "refund": {
      const charge = db.events.find((e) => e.id === action.chargeId)!;
      const refundId = newId("re");
      db.events.push({
        id: refundId,
        customerId: action.customerId,
        subscriptionId: charge.subscriptionId,
        type: "refund",
        channel: charge.channel,
        amountUsd: action.amountUsd,
        at: db.now,
        refundOf: charge.id,
        note: action.reason,
      });
      return `Refunded $${action.amountUsd.toFixed(2)} for ${charge.id} (${refundId}).`;
    }
    case "cancel_subscription": {
      const sub = db.subscriptions.find((s) => s.id === action.subscriptionId)!;
      sub.status = "canceled";
      sub.canceledAt = db.now;
      sub.renewsAt = null;
      return `Cancelled ${sub.id} (${sub.channel}). No further renewals.`;
    }
    case "grant_credit": {
      db.events.push({
        id: newId("cr"),
        customerId: action.customerId,
        subscriptionId: "",
        type: "credit",
        channel: "web",
        amountUsd: 0,
        at: db.now,
        note: `${action.months} month goodwill credit: ${action.reason}`,
      });
      return `Granted ${action.months} month credit.`;
    }
    case "batch_remediate": {
      // Each customer is re-checked by the gate individually; only auto-safe fixes run.
      const victims = new Map(findCancelPropagationVictims(db).map((v) => [v.customerId, v]));
      let fixed = 0;
      for (const customerId of action.customerIds) {
        const v = victims.get(customerId);
        if (!v) continue;
        const refund = requestAction(db, {
          kind: "refund",
          customerId,
          chargeId: v.chargeId,
          amountUsd: v.amountUsd,
          reason: `Proactive fix: ${action.rootCause}`,
        });
        const cancel = requestAction(db, {
          kind: "cancel_subscription",
          customerId,
          subscriptionId: v.renewedSubscriptionId,
        });
        if (refund.status === "executed" && cancel.status === "executed") fixed++;
      }
      return `Remediated ${fixed}/${action.customerIds.length} customers.`;
    }
  }
}

/** The only entry point for write actions: gate → execute | queue for approval | block. */
export function requestAction(db: Db, action: Action): ActionOutcome {
  const gate = evaluate(action, db);
  if (gate.decision === "block") return { status: "blocked", gate };
  if (gate.decision === "approve") {
    const pending: PendingAction = {
      id: newId("pa"),
      action,
      rule: gate.rule,
      reason: gate.reason,
      createdAt: db.now,
      status: "pending",
    };
    db.pending.push(pending);
    return { status: "pending_approval", gate, pendingId: pending.id };
  }
  return { status: "executed", gate, effect: apply(db, action) };
}

/** Human approval. Re-evaluates the gate: approval can't unlock a blocked action or replay one. */
export function approvePending(db: Db, pendingId: string): ActionOutcome {
  const pending = db.pending.find((p) => p.id === pendingId);
  if (!pending || pending.status !== "pending") {
    throw new Error(`No pending action ${pendingId}`);
  }
  const gate = evaluate(pending.action, db);
  if (gate.decision === "block") {
    pending.status = "rejected";
    return { status: "blocked", gate };
  }
  pending.status = "approved";
  return { status: "executed", gate, effect: apply(db, pending.action) };
}

export function rejectPending(db: Db, pendingId: string): void {
  const pending = db.pending.find((p) => p.id === pendingId && p.status === "pending");
  if (!pending) throw new Error(`No pending action ${pendingId}`);
  pending.status = "rejected";
}
