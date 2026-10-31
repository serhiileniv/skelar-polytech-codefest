import { describe, expect, it } from "vitest";
import type { ApiClient } from "../client";
import { ApiRequestError } from "../errors";
import type { InvestigateEvent, Outcome } from "../types";
import { createMockClient } from "./client";

const fresh = (): ApiClient => createMockClient({ delayMs: 0 });

const run = async (
  client: ApiClient,
  id: string,
): Promise<InvestigateEvent[]> => {
  const events: InvestigateEvent[] = [];
  await client.investigate(id, (e) => events.push(e));
  return events;
};

const SEQUENCE =
  /^start( step( text)*( tool_call tool_result)*)+ verdict done$/;

const CASES: [string, Outcome][] = [
  ["case_101", "user_can_fix"],
  ["case_102", "user_can_fix"],
  ["case_103", "support_can_fix"],
  ["case_104", "tech_team"],
  ["case_105", "support_can_fix"],
  ["case_106", "need_more_info"],
  ["case_107", "suspicious"],
];

describe("mock client investigate", () => {
  it.each(CASES)(
    "%s produces a well-formed run ending in %s",
    async (id, outcome) => {
      const client = fresh();

      const events = await run(client, id);

      expect(events.map((e) => e.event).join(" ")).toMatch(SEQUENCE);
      const calls = events.flatMap((e) =>
        e.event === "tool_call" ? [e.data.callId] : [],
      );
      const results = events.flatMap((e) =>
        e.event === "tool_result" ? [e.data.callId] : [],
      );
      expect(results).toEqual(calls);
      const verdictEvent = events.find((e) => e.event === "verdict");
      if (verdictEvent?.event !== "verdict")
        throw new Error("no verdict event");
      expect(verdictEvent.data.verdict.outcome).toBe(outcome);
      expect(verdictEvent.data.verdict.stepsUsed).toBeLessThanOrEqual(8);

      const detail = await client.getCase(id);
      expect(detail.case.verdict?.outcome).toBe(outcome);
      expect(detail.audit.length).toBeGreaterThan(0);
      expect(detail.audit.some((a) => a.step === "verdict")).toBe(true);
      const list = await client.listCases();
      expect(list.find((c) => c.id === id)?.outcome).toBe(outcome);
    },
  );

  it("lists no outcomes before any investigation", async () => {
    const list = await fresh().listCases();

    expect(list.map((c) => c.outcome)).toEqual(list.map(() => null));
  });
});

describe("mock client actions", () => {
  it("blocks refunds on a suspicious case with rule S1", async () => {
    const client = fresh();
    await run(client, "case_107");

    const result = await client.action("case_107", {
      kind: "support_action",
      action: { type: "refund_payment", paymentId: "pay_0008", reason: "test" },
    });

    expect(result).toMatchObject({ status: "blocked", rule: "S1" });
  });

  it("restores access once under R1 and blocks the second attempt", async () => {
    const client = fresh();
    await run(client, "case_103");
    const req = {
      kind: "support_action" as const,
      action: {
        type: "restore_access" as const,
        entitlementId: "ent_0003",
        reason: "test",
      },
    };

    const first = await client.action("case_103", req);
    const second = await client.action("case_103", req);

    expect(first).toMatchObject({ status: "executed", rule: "R1" });
    const detail = await client.getCase("case_103");
    expect(detail.entitlements.find((e) => e.id === "ent_0003")?.active).toBe(
      true,
    );
    expect(second.status).toBe("blocked");
  });

  it("refunds a duplicate charge under P1 and blocks a repeat with P3", async () => {
    const client = fresh();
    await run(client, "case_105");
    const req = {
      kind: "support_action" as const,
      action: {
        type: "refund_payment" as const,
        paymentId: "pay_0006",
        reason: "dup",
      },
    };

    const first = await client.action("case_105", req);
    const second = await client.action("case_105", req);

    expect(first).toMatchObject({ status: "executed", rule: "P1" });
    expect(second).toMatchObject({ status: "blocked", rule: "P3" });
  });

  it("creates one tech card with 38 customers and keeps one card on repeat", async () => {
    const client = fresh();
    await run(client, "case_104");

    const first = await client.action("case_104", { kind: "send_to_tech" });
    const second = await client.action("case_104", { kind: "send_to_tech" });

    expect(first).toMatchObject({ status: "executed", rule: "T1" });
    expect(second.status).toBe("executed");
    const board = await client.board();
    expect(board).toHaveLength(1);
    expect(board[0].affectedCustomerIds).toHaveLength(38);
    expect((await client.getCase("case_104")).case.status).toBe("with_tech");
  });

  it("rejects send_to_tech on a non-tech verdict with 409 conflict", async () => {
    const client = fresh();
    await run(client, "case_101");

    const attempt = client.action("case_101", { kind: "send_to_tech" });

    await expect(attempt).rejects.toBeInstanceOf(ApiRequestError);
    await expect(attempt).rejects.toMatchObject({
      status: 409,
      code: "conflict",
    });
  });
});

describe("mock client reply, metrics, abort, reset", () => {
  it("appends a support message and moves open to waiting_customer", async () => {
    const client = fresh();

    const detail = await client.reply("case_101", "  Hello there  ");

    expect(detail.case.messages.at(-1)).toMatchObject({
      from: "support",
      body: "Hello there",
    });
    expect(detail.case.status).toBe("waiting_customer");
  });

  it("rejects an empty reply with 400", async () => {
    const attempt = fresh().reply("case_101", "   ");

    await expect(attempt).rejects.toMatchObject({
      status: 400,
      code: "bad_request",
    });
  });

  it("counts investigations in metrics with all outcome keys and null eval", async () => {
    const client = fresh();
    await run(client, "case_101");
    await run(client, "case_104");

    const m = await client.metrics();

    expect(m.investigated).toBe(2);
    expect(Object.keys(m.byOutcome).sort()).toEqual([
      "need_more_info",
      "support_can_fix",
      "suspicious",
      "tech_team",
      "user_can_fix",
    ]);
    expect(m.eval).toBeNull();
  });

  it("rejects with AbortError and stores no verdict when aborted mid-run", async () => {
    const client = fresh();
    const ctrl = new AbortController();

    const attempt = client.investigate(
      "case_101",
      () => ctrl.abort(),
      ctrl.signal,
    );

    await expect(attempt).rejects.toMatchObject({ name: "AbortError" });
    expect((await client.getCase("case_101")).case.verdict).toBeNull();
  });

  it("reset restores verdicts, board and statuses", async () => {
    const client = fresh();
    await run(client, "case_104");
    await client.action("case_104", { kind: "send_to_tech" });
    await client.reply("case_101", "hi");

    await client.reset();

    expect((await client.getCase("case_104")).case.verdict).toBeNull();
    expect(await client.board()).toEqual([]);
    const list = await client.listCases();
    expect(list.every((c) => c.status === "open" && c.outcome === null)).toBe(
      true,
    );
  });
});
