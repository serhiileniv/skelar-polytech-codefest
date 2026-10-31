/**
 * HTTP contract between UI and server. UI imports types only.
 *
 * GET    /api/cases                       → CaseListItem[]
 * GET    /api/cases/[id]                  → CaseDetail
 * POST   /api/cases/[id]/investigate      → AI SDK UI message stream (tool parts: getChat, getCustomer, getBilling,
 *                                            getEntitlements, getSessionEvents, getErrorLogs, getEmailLog, searchHelp,
 *                                            findSimilarCustomers, submitVerdict). Header `x-replay: 1` when served from cache.
 * POST   /api/cases/[id]/actions  body ActionRequest → ActionResult
 * POST   /api/cases/[id]/reply    body { body: string } → CaseDetail
 * GET    /api/board                       → TechIssue[]
 * DELETE /api/state                       → { reset: true }   (demo reset)
 */
import type { AuditEntry, Case, Customer, Entitlement, Payment, Subscription, TechIssue } from "./domain/types";
import type { Outcome, SupportAction } from "./verdict/schema";

export interface CaseListItem {
  id: string;
  subject: string;
  customerName: string;
  preview: string;
  status: Case["status"];
  outcome: Outcome | null;
  createdAt: string;
}

export interface CaseDetail {
  case: Case;
  customer: Customer;
  subscriptions: Subscription[];
  payments: Payment[];
  entitlements: Entitlement[];
  audit: AuditEntry[];
}

export type ActionRequest =
  | { kind: "support_action"; action: SupportAction }
  | { kind: "send_to_tech" }
  | { kind: "mark_resolved" };

export type ActionResult =
  | { status: "executed"; message: string; rule: string }
  | { status: "blocked"; message: string; rule: string };

export type { TechIssue };
