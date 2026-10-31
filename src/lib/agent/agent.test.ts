import { simulateReadableStream, toUIMessageStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Db } from "../domain/types";
import type { Verdict } from "../verdict/schema";
import { recordTo, replayInvestigation } from "./replay";
import { runInvestigation } from "./run";
import { createInvestigationTools } from "./tools";

const NOW = "2026-10-31T10:00:00.000Z";

function fixture(): Db {
  const cust = (id: string, email: string) => ({
    id, name: id, email, platform: "web" as const, appVersion: "3.2.0", country: "US", createdAt: NOW,
  });
  return {
    now: NOW,
    customers: [cust("cus_a", "a@x.com"), cust("cus_b", "b@x.com")],
    subscriptions: [
      { id: "sub_a", customerId: "cus_a", channel: "web", plan: "monthly", priceUsd: 29.99, status: "active", renewsAt: NOW, canceledAt: null },
      { id: "sub_b", customerId: "cus_b", channel: "web", plan: "monthly", priceUsd: 29.99, status: "active", renewsAt: NOW, canceledAt: null },
    ],
    payments: [
      { id: "pay_a", customerId: "cus_a", subscriptionId: "sub_a", channel: "web", amountUsd: 29.99, status: "succeeded", at: NOW },
      { id: "pay_b", customerId: "cus_b", subscriptionId: "sub_b", channel: "web", amountUsd: 29.99, status: "succeeded", at: NOW },
    ],
    entitlements: [
      { id: "ent_a", customerId: "cus_a", accountEmail: "a@x.com", active: false, paymentId: "pay_a", grantedAt: null },
      { id: "ent_b", customerId: "cus_b", accountEmail: "b@x.com", active: true, paymentId: "pay_b", grantedAt: NOW },
    ],
    events: [
      { id: "evt_a", customerId: "cus_a", source: "web", type: "login", at: NOW },
      { id: "evt_b", customerId: "cus_b", source: "web", type: "login", at: NOW },
    ],
    errors: [
      { id: "err_a", customerId: "cus_a", service: "entitlements", code: "GRANT_FAILED", message: "grant failed", at: NOW },
      { id: "err_b", customerId: "cus_b", service: "billing", code: "X", message: "x", at: NOW },
    ],
    emails: [
      { id: "eml_a", customerId: "cus_a", to: "a@x.com", template: "receipt", status: "delivered", at: NOW },
      { id: "eml_b", customerId: "cus_b", to: "b@x.com", template: "receipt", status: "delivered", at: NOW },
    ],
    help: [{ id: "help_reset", title: "Reset your password", steps: ["Open login", "Tap Forgot password"], tags: ["password"] }],
    cases: [
      {
        id: "case_a", customerId: "cus_a", subject: "Paid but Premium locked", status: "open", createdAt: NOW, verdict: null,
        messages: [{ id: "msg_a1", from: "customer", body: "I paid but lessons are locked", at: NOW }],
      },
    ],
    techIssues: [],
    audit: [],
  };
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
};

/** One model step that calls one tool. */
function toolStep(id: string, toolName: string, input: unknown) {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start" as const, warnings: [] },
        { type: "tool-call" as const, toolCallId: id, toolName, input: JSON.stringify(input) },
        { type: "finish" as const, finishReason: { unified: "tool-calls" as const, raw: undefined }, usage },
      ],
    }),
  };
}

function verdict(evidenceIds: string[]): Verdict {
  return {
    outcome: "support_can_fix",
    confidence: 0.9,
    customerGoal: "Get Premium access they paid for",
    summary: "Payment pay_a succeeded but entitlement ent_a grant failed (err_a).",
    evidence: evidenceIds.map((id) => ({ id, note: "relevant" })),
    supportAction: { type: "restore_access", entitlementId: "ent_a", reason: "Paid, grant failed" },
    replyDraft: "Sorry about that, we restored your Premium access.",
  };
}

function scriptedModel(v: Verdict) {
  return new MockLanguageModelV4({
    doStream: [
      toolStep("c1", "getBilling", {}),
      toolStep("c2", "getEntitlements", {}),
      toolStep("c3", "getErrorLogs", {}),
      toolStep("c4", "submitVerdict", v),
    ],
  });
}

async function drain(stream: ReadableStream<unknown>) {
  const out: unknown[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return out;
    out.push(value);
  }
}

describe("investigation tools", () => {
  it("return only the case customer's records and record their ids", async () => {
    const db = fixture();
    const { tools, seenIds } = createInvestigationTools(db, "case_a");
    const opts = { toolCallId: "t", messages: [], context: {} };
    const results = await Promise.all([
      tools.getCustomer.execute!({}, opts),
      tools.getBilling.execute!({}, opts),
      tools.getEntitlements.execute!({}, opts),
      tools.getSessionEvents.execute!({}, opts),
      tools.getErrorLogs.execute!({}, opts),
      tools.getEmailLog.execute!({}, opts),
    ]);
    const json = JSON.stringify(results);
    expect(json).not.toMatch(/_b"/);
    expect([...seenIds].sort()).toEqual(["cus_a", "eml_a", "ent_a", "err_a", "evt_a", "pay_a", "sub_a"]);
  });

  it("throws for an unknown case", () => {
    expect(() => createInvestigationTools(fixture(), "nope")).toThrow();
  });
});

describe("runInvestigation", () => {
  it("stores a validated verdict after a scripted tool sequence", async () => {
    const db = fixture();
    const result = runInvestigation(db, "case_a", scriptedModel(verdict(["pay_a", "ent_a", "err_a"])));
    await drain(toUIMessageStream({ stream: result.stream }));

    const v = db.cases[0].verdict;
    expect(v?.outcome).toBe("support_can_fix");
    expect(v?.downgraded).toBe(false);
    expect(v?.stepsUsed).toBe(4);
    expect(db.audit.map((a) => a.step)).toContain("verdict_submitted");
    expect(db.audit.every((a) => a.actor === "ai")).toBe(true);
  });

  it("downgrades a verdict citing an id no tool returned", async () => {
    const db = fixture();
    const result = runInvestigation(db, "case_a", scriptedModel(verdict(["pay_a", "pay_b"])));
    await drain(toUIMessageStream({ stream: result.stream }));

    const v = db.cases[0].verdict;
    expect(v?.outcome).toBe("need_more_info");
    expect(v?.downgraded).toBe(true);
    expect(v?.modelOutcome).toBe("support_can_fix");
  });
});

describe("record / replay", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "verdict-replay-"));
    vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  it("replays a recorded run and re-applies the verdict to a fresh db", async () => {
    const live = fixture();
    const result = runInvestigation(live, "case_a", scriptedModel(verdict(["pay_a", "ent_a", "err_a"])));
    await drain(toUIMessageStream({ stream: result.stream }).pipeThrough(recordTo("case_a", "mock")));

    const fresh = fixture();
    const chunks = (await drain(replayInvestigation(fresh, "case_a", { speed: 0 }))) as { type: string }[];
    expect(chunks.some((c) => c.type === "tool-output-available")).toBe(true);
    expect(fresh.cases[0].verdict?.outcome).toBe("support_can_fix");
    expect(fresh.cases[0].verdict?.downgraded).toBe(false);
  });
});
