import type { ActionRequest, ActionResult } from "../api-contract";
import { sendToTech } from "../board/board";
import type { AuditEntry, Db } from "../domain/types";
import { evaluate } from "./gate";

let seq = 0;

export function audit(db: Db, caseId: string, actor: AuditEntry["actor"], step: string, detail: string): void {
  db.audit.push({ id: `aud_${Date.now().toString(36)}${(++seq).toString(36)}`, caseId, actor, step, detail, at: db.now });
}

/** Single entry point for human-clicked actions. Support actions always pass the policy gate first. */
export function runAction(db: Db, caseId: string, req: ActionRequest): ActionResult {
  const kase = db.cases.find((c) => c.id === caseId);
  if (!kase) return { status: "blocked", message: "Unknown case", rule: "A1" };

  if (req.kind === "send_to_tech") {
    const card = sendToTech(db, caseId);
    audit(db, caseId, "support", "send_to_tech", `${card.id} · ${card.affectedCustomerIds.length} customers`);
    return { status: "executed", message: `Added to ${card.title} (${card.affectedCustomerIds.length} customers)`, rule: "T1" };
  }

  if (req.kind === "mark_resolved") {
    kase.status = "resolved";
    audit(db, caseId, "support", "mark_resolved", "Case resolved");
    return { status: "executed", message: "Case resolved", rule: "-" };
  }

  const gate = evaluate(req.action, caseId, db);
  if (!gate.allowed) {
    audit(db, caseId, "system", `blocked:${req.action.type}`, `${gate.rule} ${gate.reason}`);
    return { status: "blocked", message: gate.reason, rule: gate.rule };
  }

  let message: string;
  if (req.action.type === "restore_access") {
    const { entitlementId } = req.action;
    const ent = db.entitlements.find((e) => e.id === entitlementId)!;
    const payment = db.payments.find((p) => p.customerId === ent.customerId && p.status === "succeeded");
    ent.active = true;
    ent.grantedAt = db.now;
    ent.paymentId = payment?.id ?? null;
    message = `Premium access restored (${ent.id})`;
  } else {
    const { paymentId } = req.action;
    const pay = db.payments.find((p) => p.id === paymentId)!;
    pay.status = "refunded";
    message = `Refunded $${pay.amountUsd.toFixed(2)} (${pay.id})`;
  }
  kase.status = "resolved";
  audit(db, caseId, "support", req.action.type, `${gate.rule} · ${message}`);
  return { status: "executed", message, rule: gate.rule };
}
