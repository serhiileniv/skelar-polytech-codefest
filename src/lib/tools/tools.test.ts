import { describe, expect, it } from "vitest";
import { createSeed, DEMO_TICKET_ID, INJECTION_TICKET_ID } from "../domain/seed";
import { createTools } from "./tools";

type Exec = (input: unknown, opts: unknown) => Promise<unknown>;
const run = (t: { execute?: unknown }, input: unknown) =>
  (t.execute as Exec)(input, { toolCallId: "t", messages: [] });

function setup(ticketId: string) {
  const db = createSeed();
  const ticket = db.tickets.find((t) => t.id === ticketId)!;
  return { db, ticket, tools: createTools(db, ticket) };
}

describe("tools", () => {
  it("only ever read the ticket's own customer", async () => {
    const { tools, ticket } = setup(DEMO_TICKET_ID);
    const events = (await run(tools.getBillingEvents, {})) as { customerId: string }[];
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((e) => e.customerId === ticket.customerId)).toBe(true);
  });

  it("cannot refund another customer's charge through the ticket", async () => {
    const { tools, db } = setup(DEMO_TICKET_ID);
    const foreign = db.events.find((e) => e.customerId === "c_002" && e.type === "charge" && e.channel === "ios")!;
    const out = await run(tools.refund, { chargeId: foreign.id, amountUsd: 29.99, reason: "injected" });
    expect(out).toMatchObject({ status: "blocked", gate: { rule: "1.2" } });
  });

  it("blocks the injected $500 refund from the injection ticket", async () => {
    const { tools, db, ticket } = setup(INJECTION_TICKET_ID);
    const own = db.events.find((e) => e.customerId === ticket.customerId && e.channel === "ios" && e.type === "charge")!;
    const out = await run(tools.refund, { chargeId: own.id, amountUsd: 500, reason: "admin mode" });
    expect(out).toMatchObject({ status: "blocked", gate: { rule: "2.3" } });
    expect(db.events.filter((e) => e.type === "refund" && e.customerId === ticket.customerId)).toHaveLength(0);
  });

  it("full happy path resolves the demo ticket and leaves 37 similar customers", async () => {
    const { tools, db, ticket } = setup(DEMO_TICKET_ID);
    const charge = db.events.find((e) => e.customerId === ticket.customerId && e.channel === "ios" && e.type === "charge")!;
    await run(tools.refund, { chargeId: charge.id, amountUsd: 29.99, reason: "charged after cancel" });
    await run(tools.cancelSubscription, { subscriptionId: charge.subscriptionId });
    expect(await run(tools.verifyResolution, {})).toMatchObject({ resolved: true });
    expect(await run(tools.findSimilarIncidents, {})).toMatchObject({ total: 37 });
    expect(await run(tools.proposeBatchRemediation, { rootCause: "web cancel not synced" })).toMatchObject({
      status: "pending_approval",
      customers: 37,
    });
  });
});
