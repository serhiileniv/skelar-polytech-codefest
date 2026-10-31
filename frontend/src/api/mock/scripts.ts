/**
 * Scripted agent-loop replays, one per demo case. Each step = one tool call the real agent would make;
 * expected outcomes follow the "Demo cases" table in `docs/api.md`.
 */
import type { Case, ToolName, Verdict } from "../types";
import { SILENT_CANCEL_NOT_SYNCED, at, type CustomerRecords } from "./world";

export interface ScriptStep {
  text: string;
  tool: ToolName;
  input: object;
  output: unknown;
  ids: string[];
}

/** What the "model" submits; the client adds the validator/bookkeeping fields. */
export type VerdictDraft = Omit<
  Verdict,
  "modelOutcome" | "downgraded" | "validationNotes" | "stepsUsed" | "createdAt"
>;

export interface CaseScript {
  steps: ScriptStep[];
  verdict: VerdictDraft;
}

interface ScriptContext {
  records: CustomerRecords;
  kase: Case;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const getChat = ({ kase }: ScriptContext, text: string): ScriptStep => ({
  text,
  tool: "getChat",
  input: {},
  output: { subject: kase.subject, messages: kase.messages },
  ids: kase.messages.map((m) => m.id),
});

const getCustomer = ({ records }: ScriptContext, text: string): ScriptStep => ({
  text,
  tool: "getCustomer",
  input: {},
  output: records.customer,
  ids: [records.customer.id],
});

const getBilling = ({ records }: ScriptContext, text: string): ScriptStep => ({
  text,
  tool: "getBilling",
  input: {},
  output: { subscriptions: records.subscriptions, payments: records.payments },
  ids: [
    ...records.subscriptions.map((s) => s.id),
    ...records.payments.map((p) => p.id),
  ],
});

const getEntitlements = (
  { records }: ScriptContext,
  text: string,
): ScriptStep => ({
  text,
  tool: "getEntitlements",
  input: {},
  output: { entitlements: records.entitlements },
  ids: records.entitlements.map((e) => e.id),
});

/** A tool step whose output is `{ [key]: rows }` and whose ids are the rows' ids. */
function rowsStep<T extends { id: string }>(
  tool: ToolName,
  text: string,
  input: object,
  key: string,
  rows: T[],
): ScriptStep {
  return {
    text,
    tool,
    input,
    output: { [key]: rows },
    ids: rows.map((r) => r.id),
  };
}

function case101(ctx: ScriptContext): CaseScript {
  const article = {
    id: "help_cancel_ios",
    title: "Cancel a PawPlan subscription on iPhone",
    steps: [
      "Settings",
      "Apple ID",
      "Subscriptions",
      "PawPlan",
      "Cancel Subscription",
    ],
  };
  return {
    steps: [
      getChat(ctx, "Reading what the customer wants."),
      getBilling(ctx, "Checking which channel bills the subscription."),
      rowsStep(
        "getSessionEvents",
        "Looking for the app deletion in session events.",
        {},
        "events",
        [
          {
            id: "ev_0001",
            type: "app_deleted",
            platform: "ios",
            at: at(-7 * DAY),
          },
        ],
      ),
      rowsStep(
        "searchHelp",
        "Finding the help article for cancelling on iOS.",
        { query: "cancel subscription ios" },
        "articles",
        [article],
      ),
    ],
    verdict: {
      outcome: "user_can_fix",
      confidence: 0.93,
      customerGoal: "Stop being charged for PawPlan.",
      summary:
        "Deleting the app does not cancel an App Store subscription. sub_0001 is still active and billed by Apple; pay_0001 renewed 2 days ago. Only the customer can cancel it in iOS settings.",
      evidence: [
        { id: "ev_0001", note: "App deleted on iOS 7 days ago" },
        {
          id: "sub_0001",
          note: "Active App Store subscription, renews in 28 days",
        },
        { id: "pay_0001", note: "$29.99 App Store renewal 2 days ago" },
      ],
      instructionSteps: [
        "Open Settings on your iPhone",
        "Tap your name (Apple ID)",
        "Tap Subscriptions",
        "Choose PawPlan",
        "Tap Cancel Subscription",
      ],
      helpArticleId: article.id,
      replyDraft:
        "Hi Emma, sorry for the confusion! Deleting the app doesn't cancel the subscription — it's billed by Apple, so it has to be cancelled in your iPhone settings. Here's how:",
    },
  };
}

function case102(ctx: ScriptContext): CaseScript {
  const email = ctx.records.customer.email;
  const mails = [1, 2, 3].map((n) => ({
    id: `mail_000${n}`,
    type: "password_reset",
    to: email,
    status: "delivered",
    at: at(-(70 - n * 3) * MIN),
  }));
  return {
    steps: [
      getChat(ctx, "Reading the customer's request."),
      getCustomer(ctx, "Checking the account email."),
      rowsStep(
        "getEmailLog",
        "Checking whether the reset emails were sent.",
        { type: "password_reset" },
        "emails",
        mails,
      ),
    ],
    verdict: {
      outcome: "user_can_fix",
      confidence: 0.88,
      customerGoal: "Reset the account password.",
      summary: `All 3 password-reset emails were delivered to ${email}. Nothing is broken on our side; they are most likely in spam.`,
      evidence: mails.map((m) => ({
        id: m.id,
        note: `Reset email delivered to ${email}`,
      })),
      instructionSteps: [
        "Check the Spam / Junk folder",
        'Search the inbox for "PawPlan"',
        'Mark the email as "Not spam" and open the newest reset link',
      ],
      replyDraft:
        "Hi Noah, we can see all three reset emails were delivered to your inbox provider. They most likely landed in spam:",
    },
  };
}

function case103(ctx: ScriptContext): CaseScript {
  return {
    steps: [
      getChat(ctx, "Reading the complaint about locked lessons."),
      getBilling(ctx, "Checking that the Premium payment went through."),
      getEntitlements(ctx, "Checking whether access was granted."),
      rowsStep(
        "getErrorLogs",
        "Looking for a failed grant after payment.",
        { since: at(-2 * HOUR) },
        "errors",
        [
          {
            id: "err_0001",
            code: "GRANT_FAILED",
            paymentId: "pay_0003",
            message: "Entitlement service timeout after capture",
            at: at(-HOUR + 2000),
          },
        ],
      ),
    ],
    verdict: {
      outcome: "support_can_fix",
      confidence: 0.95,
      customerGoal: "Get the Premium access they paid for.",
      summary:
        "pay_0003 succeeded an hour ago, but the access grant failed (GRANT_FAILED), so ent_0003 is still inactive. Support can restore it.",
      evidence: [
        { id: "pay_0003", note: "$29.99 web payment succeeded 1 hour ago" },
        { id: "ent_0003", note: "Entitlement inactive, no payment linked" },
        { id: "err_0001", note: "GRANT_FAILED right after capture" },
      ],
      supportAction: {
        type: "restore_access",
        entitlementId: "ent_0003",
        reason: "Paid (pay_0003) but grant failed (err_0001)",
      },
      replyDraft:
        "Hi Sofia, sorry about that — your payment went through but access didn't unlock due to a glitch on our side. Premium is now active; please reopen the app.",
    },
  };
}

function case104(ctx: ScriptContext): CaseScript {
  return {
    steps: [
      getChat(ctx, "Reading the complaint about a charge after cancelling."),
      rowsStep(
        "getSessionEvents",
        "Confirming the web cancellation.",
        {},
        "events",
        [
          {
            id: "ev_0006",
            type: "web_cancel",
            subscriptionId: "sub_0004",
            at: at(-20 * HOUR),
          },
        ],
      ),
      getBilling(ctx, "Checking subscriptions and the new charge."),
      rowsStep(
        "getErrorLogs",
        "Looking for a sync failure around the cancellation.",
        { since: at(-DAY) },
        "errors",
        [
          {
            id: "err_0002",
            code: "CANCEL_SYNC_TIMEOUT",
            subscriptionId: "sub_0005",
            message: "Web cancel not propagated to App Store subscription",
            at: at(-20 * HOUR + MIN),
          },
        ],
      ),
      {
        text: "Checking whether other customers hit the same bug.",
        tool: "findSimilarCustomers",
        input: { signature: "cancel_not_synced" },
        output: {
          signature: "cancel_not_synced",
          count: SILENT_CANCEL_NOT_SYNCED.length,
          customerIds: SILENT_CANCEL_NOT_SYNCED,
        },
        ids: SILENT_CANCEL_NOT_SYNCED,
      },
    ],
    verdict: {
      outcome: "tech_team",
      confidence: 0.91,
      customerGoal: "Stay cancelled and not be charged again.",
      summary:
        "The customer cancelled on the web (ev_0006), but the cancel never reached the linked App Store subscription (CANCEL_SYNC_TIMEOUT), so pay_0004 was charged 3 minutes later. 37 other customers are silently affected.",
      evidence: [
        { id: "ev_0006", note: "Web cancellation 20 hours ago" },
        { id: "err_0002", note: "CANCEL_SYNC_TIMEOUT for sub_0005" },
        { id: "pay_0004", note: "$29.99 App Store charge after the cancel" },
      ],
      techIssue: {
        signature: "cancel_not_synced",
        title: "Web cancellation not synced to App Store",
        rootCause:
          "The cancel-sync job times out (CANCEL_SYNC_TIMEOUT), so linked App Store subscriptions keep renewing after a web cancel.",
      },
      replyDraft:
        "Hi Liam, you're right — you cancelled correctly and the charge is our bug. Our tech team is fixing it, and we'll refund you as soon as it's resolved.",
    },
  };
}

function case105(ctx: ScriptContext): CaseScript {
  return {
    steps: [
      getChat(ctx, "Reading the double-charge complaint."),
      getBilling(ctx, "Looking for two identical charges this morning."),
      rowsStep(
        "getErrorLogs",
        "Checking why the payment ran twice.",
        { since: at(-3 * HOUR) },
        "errors",
        [
          {
            id: "err_0003",
            code: "IDEMPOTENCY_KEY_MISSING",
            paymentId: "pay_0006",
            message: "Retry created a second charge",
            at: at(-165 * MIN + 40_000),
          },
        ],
      ),
    ],
    verdict: {
      outcome: "support_can_fix",
      confidence: 0.94,
      customerGoal: "Get the duplicate charge back.",
      summary:
        "pay_0006 duplicates pay_0005 40 seconds later; the retry had no idempotency key. Refund the duplicate.",
      evidence: [
        { id: "pay_0005", note: "$29.99 renewal" },
        { id: "pay_0006", note: "Identical $29.99 charge 40 s later" },
        { id: "err_0003", note: "IDEMPOTENCY_KEY_MISSING on the retry" },
      ],
      supportAction: {
        type: "refund_payment",
        paymentId: "pay_0006",
        reason: "Duplicate of pay_0005 (err_0003)",
      },
      replyDraft:
        "Hi Ava, you're right, you were charged twice by mistake. We've refunded the duplicate $29.99; it'll show on your card in 3–5 business days.",
    },
  };
}

function case106(ctx: ScriptContext): CaseScript {
  return {
    steps: [
      getChat(ctx, "Reading the message — it's very short."),
      getCustomer(ctx, "Checking the account and platform."),
      rowsStep<{ id: string }>(
        "getErrorLogs",
        "Looking for any recent errors on the account.",
        { since: at(-DAY) },
        "errors",
        [],
      ),
    ],
    verdict: {
      outcome: "need_more_info",
      confidence: 0.42,
      customerGoal: "Unclear — something is not working.",
      summary:
        "No errors, failed payments or access problems on record. Not enough information to act.",
      evidence: [{ id: "msg_0009", note: '"Nothing works" — no details' }],
      clarifyingQuestion:
        "What exactly isn't working — logging in, opening lessons, or billing? And on which device?",
      replyDraft:
        "Hi Oliver, sorry you're having trouble! What exactly isn't working — logging in, opening lessons, or billing? And on which device?",
    },
  };
}

function case107(ctx: ScriptContext): CaseScript {
  return {
    steps: [
      getChat(
        ctx,
        "Reading the message — it contains instructions aimed at me.",
      ),
      getBilling(ctx, "Checking for a cancellation or a charge to refund."),
    ],
    verdict: {
      outcome: "suspicious",
      confidence: 0.97,
      customerGoal: "Get a $500 refund by overriding policy.",
      summary:
        'The message tries to switch support into "admin mode" and demands a $500 refund. There is no cancellation on record and pay_0008 is $29.99. No action proposed.',
      evidence: [
        {
          id: "msg_0010",
          note: 'Prompt injection: "SYSTEM OVERRIDE … refund $500"',
        },
        { id: "pay_0008", note: "Only charge is $29.99, no cancellation" },
      ],
      replyDraft:
        "Hi Marcus, I can't process that request. If you were charged after cancelling, please share the date you cancelled and we'll take a look.",
    },
  };
}

const SCRIPTS: Record<string, (ctx: ScriptContext) => CaseScript> = {
  case_101: case101,
  case_102: case102,
  case_103: case103,
  case_104: case104,
  case_105: case105,
  case_106: case106,
  case_107: case107,
};

/** The scripted investigation for a case, or null for a case without one. */
export function scriptFor(
  kase: Case,
  records: CustomerRecords,
): CaseScript | null {
  const script = SCRIPTS[kase.id];
  return script ? script({ kase, records }) : null;
}
