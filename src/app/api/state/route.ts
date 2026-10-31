import { getDb, resetDb } from "@/lib/domain/store";
import { findCancelPropagationVictims, summarize } from "@/lib/insights/blastRadius";
import { verifyCancellationResolved } from "@/lib/verify/verifier";

export const dynamic = "force-dynamic";

/** Read model for the UI: tickets, pending approvals, bugs, impact metrics. */
export async function GET(): Promise<Response> {
  const db = getDb();
  const victims = findCancelPropagationVictims(db);
  const writers = db.tickets.map((t) => ({
    ...t,
    customer: db.customers.find((c) => c.id === t.customerId),
    verification: verifyCancellationResolved(db, t.customerId),
  }));
  const refunds = db.events.filter((e) => e.type === "refund" && e.at === db.now);
  return Response.json({
    tickets: writers,
    pending: db.pending,
    bugs: db.bugs,
    replies: db.replies,
    blastRadius: { ...summarize(db, victims), victims },
    impact: {
      refundsIssued: refunds.length,
      refundedUsd: Math.round(refunds.reduce((s, e) => s + e.amountUsd, 0) * 100) / 100,
      customersVerifiedResolved: db.customers.filter(
        (c) => db.events.some((e) => e.customerId === c.id && e.type === "refund" && e.at === db.now) &&
          verifyCancellationResolved(db, c.id).resolved,
      ).length,
    },
  });
}

/** Demo reset. */
export async function DELETE(): Promise<Response> {
  resetDb();
  return Response.json({ reset: true });
}
