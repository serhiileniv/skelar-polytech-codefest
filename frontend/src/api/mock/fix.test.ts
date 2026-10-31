import { describe, expect, it } from "vitest";
import type { ApiClient } from "../client";
import type { FixAutoStep, FixEvent, FixPlan } from "../types";
import { createMockClient } from "./client";
import { runPlan } from "./fix";
import { applyAction, type MockState } from "./policy";
import { createWorld } from "./world";

const fresh = (): ApiClient => createMockClient({ delayMs: 0 });

async function investigated(id: string): Promise<ApiClient> {
  const client = fresh();
  await client.investigate(id, () => {});
  return client;
}

async function fix(
  client: ApiClient,
  id: string,
): Promise<{ events: FixEvent[]; plan: FixPlan }> {
  const events: FixEvent[] = [];
  await client.fix(id, (e) => events.push(e));
  const planEvent = events.find((e) => e.event === "plan");
  if (planEvent?.event !== "plan") throw new Error("no plan event");
  return { events, plan: planEvent.data.plan };
}

const autoIds = (plan: FixPlan): string[] =>
  plan.steps.flatMap((s) => (s.kind === "auto" ? [s.id] : []));

const SEQUENCE = /^start( step text tool_call tool_result)+ plan done$/;

interface FlowCase {
  id: string;
  tools: string[];
  actions: string[];
  rules: string[];
  manualOwners: string[];
  resolved: boolean;
}

const FLOWS: FlowCase[] = [
  {
    id: "case_101",
    tools: ["cancelSubscription"],
    actions: ["cancel_subscription"],
    rules: ["C1"],
    manualOwners: ["customer"],
    resolved: false,
  },
  {
    id: "case_102",
    tools: ["sendMagicLink"],
    actions: ["send_magic_link"],
    rules: ["E1"],
    manualOwners: ["customer"],
    resolved: false,
  },
  {
    id: "case_103",
    tools: ["restoreAccess"],
    actions: ["restore_access"],
    rules: ["R1"],
    manualOwners: [],
    resolved: true,
  },
  {
    id: "case_105",
    tools: ["refundPayment"],
    actions: ["refund_payment"],
    rules: ["P1"],
    manualOwners: ["tech"],
    resolved: false,
  },
];

describe("mock fix flows", () => {
  it.each(FLOWS)(
    "$id plans, approves all auto steps and audits",
    async ({ id, tools, actions, rules, manualOwners, resolved }) => {
      const client = await investigated(id);

      const { events, plan } = await fix(client, id);
      const result = await client.approveFix(id, plan.id, autoIds(plan));

      expect(events.map((e) => e.event).join(" ")).toMatch(SEQUENCE);
      const steps = events.filter((e) => e.event === "step").length;
      expect(steps).toBeLessThanOrEqual(6);
      const auto = plan.steps.filter(
        (s): s is FixAutoStep => s.kind === "auto",
      );
      expect(auto.map((s) => s.tool)).toEqual(tools);
      expect(auto.map((s) => s.rule)).toEqual(rules);
      expect(auto.every((s) => s.wouldBe === "executed")).toBe(true);
      expect(
        plan.steps.flatMap((s) => (s.kind === "manual" ? [s.owner] : [])),
      ).toEqual(manualOwners);
      expect(result).toMatchObject({
        status: "executed",
        replied: true,
        resolved,
      });
      expect(result.steps.map((s) => s.status)).toEqual(
        tools.map(() => "executed"),
      );
      const detail = await client.getCase(id);
      expect(detail.case.messages.at(-1)?.from).toBe("support");
      expect(detail.case.status).toBe(
        resolved ? "resolved" : "waiting_customer",
      );
      const audit = detail.audit.map((a) => a.step);
      expect(audit).toEqual(
        expect.arrayContaining([
          "fix:plan_proposed",
          "fix:approved",
          `action:${actions[0]}`,
          "fix:completed",
        ]),
      );
    },
  );

  it("case_101 cancels sub_0001 via the simulated store connector", async () => {
    const client = await investigated("case_101");
    const { plan } = await fix(client, "case_101");

    const result = await client.approveFix("case_101", plan.id, autoIds(plan));

    const sub = (await client.getCase("case_101")).subscriptions.find(
      (s) => s.id === "sub_0001",
    );
    expect(sub).toMatchObject({ status: "canceled", renewsAt: null });
    expect(result.steps[0].result?.message).toContain("simulated");
  });

  it.each(["case_104", "case_106", "case_107"])(
    "%s is refused with 409 (F1 / S1)",
    async (id) => {
      const client = await investigated(id);

      await expect(client.fix(id, () => {})).rejects.toMatchObject({
        status: 409,
        code: "conflict",
      });
    },
  );

  it("refuses Fix-it before an investigation", async () => {
    await expect(fresh().fix("case_101", () => {})).rejects.toMatchObject({
      status: 409,
    });
  });

  it("skips unselected steps; still replies and resolves when nothing blocked", async () => {
    const client = await investigated("case_103");
    const { plan } = await fix(client, "case_103");

    const result = await client.approveFix("case_103", plan.id, []);

    expect(result.steps.map((s) => s.status)).toEqual(["skipped"]);
    expect(result).toMatchObject({ replied: true, resolved: true });
    const ent = (await client.getCase("case_103")).entitlements[0];
    expect(ent.active).toBe(false);
  });

  it("stops at a step the gate now blocks; no reply, not resolved", async () => {
    const client = await investigated("case_105");
    const { plan } = await fix(client, "case_105");
    await client.action("case_105", {
      kind: "support_action",
      action: { type: "refund_payment", paymentId: "pay_0006", reason: "x" },
    });

    const result = await client.approveFix("case_105", plan.id, autoIds(plan));

    expect(result).toMatchObject({
      status: "stopped",
      replied: false,
      resolved: false,
    });
    expect(result.steps.map((s) => s.status)).toEqual(["blocked"]);
    expect(result.steps[0].result?.rule).toBe("P3");
    const audit = (await client.getCase("case_105")).audit.map((a) => a.step);
    expect(audit).toContain("fix:stopped");
  });

  it("previews a blocked step unchecked-by-default when the gate would block", async () => {
    const client = await investigated("case_102");
    const first = await fix(client, "case_102");
    await client.approveFix("case_102", first.plan.id, autoIds(first.plan));

    const { plan } = await fix(client, "case_102");

    const link = plan.steps.find(
      (s): s is FixAutoStep => s.kind === "auto" && s.tool === "sendMagicLink",
    );
    expect(link).toMatchObject({ wouldBe: "blocked", rule: "E1" });
  });

  it("rejects a second approve with 409 and an unknown plan with 404", async () => {
    const client = await investigated("case_103");
    const { plan } = await fix(client, "case_103");
    await client.approveFix("case_103", plan.id, autoIds(plan));

    await expect(
      client.approveFix("case_103", plan.id, autoIds(plan)),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      client.approveFix("case_103", "plan_9999", []),
    ).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    [
      "a manual step",
      (p: FixPlan) => [p.steps.find((s) => s.kind === "manual")?.id ?? ""],
    ],
    ["an unknown step", () => ["step_99"]],
    ["a repeated step", (p: FixPlan) => [...autoIds(p), ...autoIds(p)]],
  ])("rejects %s with 400", async (_label, pick) => {
    const client = await investigated("case_101");
    const { plan } = await fix(client, "case_101");

    await expect(
      client.approveFix("case_101", plan.id, pick(plan)),
    ).rejects.toMatchObject({ status: 400 });
  });

  it("lists capabilities for customer and support", async () => {
    const caps = await fresh().fixCapabilities();

    expect(caps.map((c) => `${c.actor}:${c.tool}:${c.rule}`)).toEqual([
      "customer:cancelSubscription:C1",
      "customer:sendMagicLink:E1",
      "support:restoreAccess:R1",
      "support:refundPayment:P1",
    ]);
  });
});

describe("runPlan", () => {
  const state = (): MockState => ({
    world: createWorld(),
    board: [],
    audit: [],
    actions: { executed: 0, blocked: 0 },
    seq: 0,
  });
  const step = (
    id: string,
    tool: FixAutoStep["tool"],
    input: Record<string, unknown>,
  ): FixAutoStep => ({
    id,
    kind: "auto",
    owner: "agent",
    title: id,
    detail: "",
    tool,
    actor: "support",
    input,
    rule: "",
    wouldBe: "executed",
    previewMessage: "",
  });
  const plan: FixPlan = {
    id: "plan_x",
    caseId: "case_101",
    problem: "",
    summary: "",
    createdAt: "",
    replyBody: "done",
    steps: [
      step("a", "cancelSubscription", {
        subscriptionId: "sub_0001",
        reason: "r",
      }),
      step("b", "refundPayment", { paymentId: "pay_0001", reason: "r" }),
      step("c", "restoreAccess", { entitlementId: "ent_0001", reason: "r" }),
    ],
  };

  it("skips every step after the first block", () => {
    const now = "2026-10-31T10:00:00.000Z";
    const canceled = applyAction(
      state(),
      "case_101",
      {
        kind: "support_action",
        action: {
          type: "cancel_subscription",
          subscriptionId: "sub_0001",
          reason: "r",
        },
      },
      now,
    ).state;

    const { result } = runPlan(canceled, plan, ["a", "b", "c"], now);

    expect(result.status).toBe("stopped");
    expect(result.steps.map((s) => [s.stepId, s.status])).toEqual([
      ["a", "blocked"],
      ["b", "skipped"],
      ["c", "skipped"],
    ]);
    expect(result.steps[0].result?.rule).toBe("C1");
    expect(result.replied).toBe(false);
  });
});
