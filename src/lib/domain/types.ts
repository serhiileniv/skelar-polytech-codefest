/**
 * Simulated production world of "PawPlan" (dog-training subscription app, web + iOS).
 * Every record has a stable `id` so the agent can cite it as evidence.
 */
import type { StoredVerdict } from "../verdict/schema";

export type Platform = "web" | "ios" | "android";

export interface Customer {
  id: string;
  name: string;
  email: string;
  platform: Platform;
  appVersion: string;
  country: string;
  createdAt: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  channel: "web" | "app_store";
  plan: "monthly" | "yearly";
  priceUsd: number;
  status: "active" | "canceled";
  renewsAt: string | null;
  canceledAt: string | null;
}

export interface Payment {
  id: string;
  customerId: string;
  subscriptionId: string;
  channel: "web" | "app_store";
  amountUsd: number;
  status: "succeeded" | "refunded" | "failed";
  at: string;
}

export interface Entitlement {
  id: string;
  customerId: string;
  /** Account the Premium access is attached to. */
  accountEmail: string;
  active: boolean;
  paymentId: string | null;
  grantedAt: string | null;
}

/** What the user did, from web analytics and the iOS app. */
export interface SessionEvent {
  id: string;
  customerId: string;
  source: "web" | "ios" | "android";
  type: string; // e.g. "login", "cancel_clicked", "app_deleted", "open_lessons", "password_reset_requested"
  detail?: string;
  appVersion?: string;
  at: string;
}

/** Backend / app error logs. */
export interface ErrorLog {
  id: string;
  customerId: string | null;
  service: "billing" | "entitlements" | "auth" | "email" | "app";
  code: string;
  message: string;
  appVersion?: string;
  at: string;
}

export interface EmailLog {
  id: string;
  customerId: string;
  to: string;
  template: string;
  status: "delivered" | "bounced";
  at: string;
}

export interface HelpArticle {
  id: string;
  title: string;
  steps: string[];
  tags: string[];
}

export interface ChatMessage {
  id: string;
  from: "customer" | "support";
  body: string;
  at: string;
}

export interface Case {
  id: string;
  customerId: string;
  subject: string;
  messages: ChatMessage[];
  status: "open" | "waiting_customer" | "with_tech" | "resolved";
  createdAt: string;
  verdict: StoredVerdict | null;
}

export interface TechIssue {
  id: string;
  /** Stable key used to merge cases with the same root cause. */
  signature: string;
  title: string;
  rootCause: string;
  evidenceIds: string[];
  caseIds: string[];
  affectedCustomerIds: string[];
  status: "new" | "in_progress" | "resolved";
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  caseId: string;
  actor: "ai" | "support" | "system";
  step: string;
  detail: string;
  at: string;
}

export interface Db {
  now: string;
  customers: Customer[];
  subscriptions: Subscription[];
  payments: Payment[];
  entitlements: Entitlement[];
  events: SessionEvent[];
  errors: ErrorLog[];
  emails: EmailLog[];
  help: HelpArticle[];
  cases: Case[];
  techIssues: TechIssue[];
  audit: AuditEntry[];
}
