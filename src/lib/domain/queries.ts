import type { CaseDetail } from "../api-contract";
import type { Db } from "./types";

export function caseDetail(db: Readonly<Db>, id: string): CaseDetail | null {
  const kase = db.cases.find((c) => c.id === id);
  const customer = kase && db.customers.find((c) => c.id === kase.customerId);
  if (!kase || !customer) return null;
  return {
    case: kase,
    customer,
    subscriptions: db.subscriptions.filter((s) => s.customerId === customer.id),
    payments: db.payments.filter((p) => p.customerId === customer.id),
    entitlements: db.entitlements.filter((e) => e.customerId === customer.id),
    audit: db.audit.filter((a) => a.caseId === id),
  };
}
