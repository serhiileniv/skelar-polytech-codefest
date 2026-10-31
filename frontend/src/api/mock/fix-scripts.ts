/**
 * Scripted Fix-it runs for the four fixable demo cases. Read steps become tool calls; the plan is what
 * `submitFixPlan` would submit. External systems (App Store, email) are simulated, as in the Go demo world.
 */
import type {
  Case,
  FixActor,
  FixManualStep,
  FixToolName,
  FixWriteTool,
} from "../types";
import { at, type CustomerRecords } from "./world";

const MIN = 60_000;

export interface FixReadStep {
  text: string;
  tool: FixToolName;
  output: unknown;
  ids: string[];
}

export interface FixAutoDraft {
  kind: "auto";
  tool: FixWriteTool;
  actor: FixActor;
  title: string;
  detail: string;
  input: Record<string, unknown>;
  /** Agent thought before the write tool call. */
  text: string;
}

export type FixManualDraft = Omit<FixManualStep, "id">;

export interface FixScript {
  reads: FixReadStep[];
  problem: string;
  summary: string;
  steps: (FixAutoDraft | FixManualDraft)[];
  replyBody: string;
}

interface Ctx {
  kase: Case;
  records: CustomerRecords;
}

const getCase = ({ kase }: Ctx): FixReadStep => ({
  text: "Re-reading the case and the confirmed verdict.",
  tool: "getCase",
  output: { messages: kase.messages, verdict: kase.verdict },
  ids: kase.messages.map((m) => m.id),
});

const getBilling = ({ records }: Ctx, text: string): FixReadStep => ({
  text,
  tool: "getBilling",
  output: { subscriptions: records.subscriptions, payments: records.payments },
  ids: [
    ...records.subscriptions.map((s) => s.id),
    ...records.payments.map((p) => p.id),
  ],
});

function case101(ctx: Ctx): FixScript {
  return {
    reads: [
      getCase(ctx),
      getBilling(ctx, "Confirming sub_0001 is still active and billed."),
    ],
    problem:
      "App Store subscription sub_0001 is still active after the app was deleted (ev_0001, pay_0001).",
    summary:
      "Cancel sub_0001 through the store connector so it stops renewing, then tell the customer it is done.",
    steps: [
      {
        kind: "auto",
        tool: "cancelSubscription",
        actor: "customer",
        title: "Cancel App Store subscription sub_0001",
        detail:
          "Simulated connector: the demo App Store cancels on the customer's behalf.",
        input: {
          subscriptionId: "sub_0001",
          reason: "Customer deleted the app and wants billing to stop",
        },
        text: "Queuing the cancel through the simulated App Store connector.",
      },
      {
        kind: "manual",
        owner: "customer",
        title: "Confirm the cancellation email from Apple",
        detail: "Apple sends it to the Apple ID email within a few minutes.",
      },
    ],
    replyBody:
      "Hi Emma, done: your PawPlan subscription is cancelled and will not renew. Apple will email you a confirmation.",
  };
}

function case102(ctx: Ctx): FixScript {
  const email = ctx.records.customer.email;
  const mails = [1, 2, 3].map((n) => ({
    id: `mail_000${n}`,
    type: "password_reset",
    to: email,
    status: "delivered",
    at: at(-(70 - n * 3) * MIN),
  }));
  return {
    reads: [
      getCase(ctx),
      {
        text: "Checking the three reset emails.",
        tool: "getEmailLog",
        output: { emails: mails },
        ids: mails.map((m) => m.id),
      },
    ],
    problem: `Three password-reset emails were delivered to ${email} but never reached the inbox (mail_0001..mail_0003).`,
    summary:
      "Send a one-time login link instead of a fourth reset email, then tell the customer where to look.",
    steps: [
      {
        kind: "auto",
        tool: "sendMagicLink",
        actor: "customer",
        title: "Send a one-time login link",
        detail: `Template magic_link to ${email}.`,
        input: { reason: "Reset emails land in spam" },
        text: "Queuing a one-time login link.",
      },
      {
        kind: "manual",
        owner: "customer",
        title: "Open the login link and set a new password",
        detail: "The link works once.",
      },
    ],
    replyBody:
      "Hi Noah, we've sent you a one-time login link. If it isn't in your inbox, check Spam and mark it as not spam. Once in, you can set a new password in Settings.",
  };
}

function case103(ctx: Ctx): FixScript {
  return {
    reads: [
      getCase(ctx),
      {
        text: "Confirming ent_0003 is still inactive.",
        tool: "getEntitlements",
        output: { entitlements: ctx.records.entitlements },
        ids: ctx.records.entitlements.map((e) => e.id),
      },
    ],
    problem:
      "Payment pay_0003 succeeded but the access grant failed, so ent_0003 is inactive (err_0001).",
    summary: "Restore ent_0003 and let the customer know Premium is active.",
    steps: [
      {
        kind: "auto",
        tool: "restoreAccess",
        actor: "support",
        title: "Restore Premium on ent_0003",
        detail: "Links the entitlement to pay_0003.",
        input: {
          entitlementId: "ent_0003",
          reason: "Paid (pay_0003) but grant failed (err_0001)",
        },
        text: "Queuing the access restore.",
      },
    ],
    replyBody:
      "Hi Sofia, sorry about that. Your payment went through but access didn't unlock due to a glitch on our side. Premium is now active; please reopen the app.",
  };
}

function case105(ctx: Ctx): FixScript {
  return {
    reads: [
      getCase(ctx),
      getBilling(ctx, "Confirming pay_0006 duplicates pay_0005."),
    ],
    problem:
      "pay_0006 is a duplicate of pay_0005 charged 40 s later by a retry without an idempotency key (err_0003).",
    summary:
      "Refund the duplicate, tell the customer, and hand the retry bug to the tech team.",
    steps: [
      {
        kind: "auto",
        tool: "refundPayment",
        actor: "support",
        title: "Refund duplicate charge pay_0006",
        detail: "$29.99 back to the card.",
        input: { paymentId: "pay_0006", reason: "Duplicate of pay_0005" },
        text: "Queuing the refund of the duplicate.",
      },
      {
        kind: "manual",
        owner: "tech",
        title: "Add an idempotency key to payment retries",
        detail: "Root cause of the duplicate (err_0003).",
      },
    ],
    replyBody:
      "Hi Ava, you're right, you were charged twice by mistake. We've refunded the duplicate $29.99; it'll show on your card in 3–5 business days.",
  };
}

const SCRIPTS: Record<string, (ctx: Ctx) => FixScript> = {
  case_101: case101,
  case_102: case102,
  case_103: case103,
  case_105: case105,
};

export function fixScriptFor(
  kase: Case,
  records: CustomerRecords,
): FixScript | null {
  const script = SCRIPTS[kase.id];
  return script ? script({ kase, records }) : null;
}
