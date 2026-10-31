export type Channel = "web" | "ios" | "android";

export interface Customer {
  id: string;
  name: string;
  email: string;
  country: string;
  ltvUsd: number;
  /** Prior bank dispute or explicit dispute threat — raises chargeback risk. */
  disputeHistory: boolean;
  joinedAt: string;
}

export interface Subscription {
  id: string;
  customerId: string;
  channel: Channel;
  plan: string;
  priceUsd: number;
  status: "active" | "canceled";
  renewsAt: string | null;
  canceledAt: string | null;
}

export type BillingEventType = "charge" | "refund" | "cancel_request" | "credit";

export interface BillingEvent {
  id: string;
  customerId: string;
  subscriptionId: string;
  type: BillingEventType;
  channel: Channel;
  amountUsd: number;
  at: string;
  /** For refunds: the charge being refunded. */
  refundOf?: string;
  note?: string;
}

export interface Ticket {
  id: string;
  customerId: string;
  subject: string;
  body: string;
  createdAt: string;
  status: "open" | "resolved";
}

export interface Bug {
  id: string;
  title: string;
  body: string;
  affectedCustomerIds: string[];
  createdAt: string;
}

export interface Reply {
  ticketId: string;
  body: string;
  sentAt: string;
}

export interface PendingAction {
  id: string;
  action: import("../policy/actions").Action;
  rule: string;
  reason: string;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
}

export interface Db {
  now: string;
  customers: Customer[];
  subscriptions: Subscription[];
  events: BillingEvent[];
  tickets: Ticket[];
  bugs: Bug[];
  replies: Reply[];
  pending: PendingAction[];
}
