import type { Db } from "../domain/types";

export interface Victim {
  customerId: string;
  name: string;
  cancelAt: string;
  chargeId: string;
  chargeAt: string;
  amountUsd: number;
  renewedSubscriptionId: string;
  cancelChannel: string;
  chargeChannel: string;
  disputeRisk: boolean;
}

export interface BlastRadiusOptions {
  /** Max gap between cancel and the stray charge. */
  windowMinutes?: number;
  lookbackDays?: number;
}

/**
 * Root-cause pattern: cancel on one channel, then a charge on ANOTHER channel within minutes,
 * not yet refunded. Deterministic so the number on stage is reproducible and testable.
 */
export function findCancelPropagationVictims(db: Readonly<Db>, opts: BlastRadiusOptions = {}): Victim[] {
  const windowMs = (opts.windowMinutes ?? 60) * 60_000;
  const since = new Date(db.now).getTime() - (opts.lookbackDays ?? 7) * 86_400_000;
  const refunded = new Set(db.events.filter((e) => e.type === "refund").map((e) => e.refundOf));
  const victims: Victim[] = [];

  for (const cancel of db.events) {
    if (cancel.type !== "cancel_request") continue;
    const cancelMs = new Date(cancel.at).getTime();
    if (cancelMs < since) continue;

    const charge = db.events.find((e) => {
      if (e.type !== "charge" || e.customerId !== cancel.customerId) return false;
      if (e.channel === cancel.channel || refunded.has(e.id)) return false;
      const gap = new Date(e.at).getTime() - cancelMs;
      return gap > 0 && gap <= windowMs;
    });
    if (!charge) continue;

    const customer = db.customers.find((c) => c.id === cancel.customerId)!;
    victims.push({
      customerId: customer.id,
      name: customer.name,
      cancelAt: cancel.at,
      chargeId: charge.id,
      chargeAt: charge.at,
      amountUsd: charge.amountUsd,
      renewedSubscriptionId: charge.subscriptionId,
      cancelChannel: cancel.channel,
      chargeChannel: charge.channel,
      disputeRisk: customer.disputeHistory,
    });
  }
  return victims;
}

export interface BlastRadiusSummary {
  total: number;
  silent: number;
  disputeRisk: number;
  exposureUsd: number;
}

export function summarize(db: Readonly<Db>, victims: Victim[]): BlastRadiusSummary {
  const writers = new Set(db.tickets.map((t) => t.customerId));
  return {
    total: victims.length,
    silent: victims.filter((v) => !writers.has(v.customerId)).length,
    disputeRisk: victims.filter((v) => v.disputeRisk).length,
    exposureUsd: Math.round(victims.reduce((s, v) => s + v.amountUsd, 0) * 100) / 100,
  };
}
