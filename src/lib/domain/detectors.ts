/** Root-cause detectors over structured records (never over case text). Return affected customer ids, sorted. */
import type { Signature } from "../verdict/schema";
import type { Db, Payment } from "./types";

const MIN = 60_000;
const ms = (iso: string) => Date.parse(iso);

/** Web cancel followed by a succeeded (not refunded) App Store charge within 60 min. */
function cancelNotSynced(db: Readonly<Db>): string[] {
  const hits = new Set<string>();
  for (const web of db.subscriptions) {
    if (web.channel !== "web" || web.status !== "canceled" || !web.canceledAt) continue;
    const t = ms(web.canceledAt);
    const charged = db.payments.some(
      (p) =>
        p.customerId === web.customerId &&
        p.channel === "app_store" &&
        p.status === "succeeded" &&
        ms(p.at) > t &&
        ms(p.at) - t <= 60 * MIN,
    );
    if (charged) hits.add(web.customerId);
  }
  return [...hits];
}

/** Succeeded payment on an active subscription, but the customer has no active entitlement. */
function entitlementGrantFailed(db: Readonly<Db>): string[] {
  const activeSubs = new Set(db.subscriptions.filter((s) => s.status === "active").map((s) => s.id));
  const entitled = new Set(db.entitlements.filter((e) => e.active).map((e) => e.customerId));
  const hits = new Set<string>();
  for (const p of db.payments) {
    if (p.status === "succeeded" && activeSubs.has(p.subscriptionId) && !entitled.has(p.customerId)) hits.add(p.customerId);
  }
  return [...hits];
}

/** Two succeeded payments on the same subscription within 5 min (refunded ones don't count). */
function duplicateCharge(db: Readonly<Db>): string[] {
  const bySub = new Map<string, Payment[]>();
  for (const p of db.payments) {
    if (p.status !== "succeeded") continue;
    bySub.set(p.subscriptionId, [...(bySub.get(p.subscriptionId) ?? []), p]);
  }
  const hits = new Set<string>();
  for (const list of bySub.values()) {
    const sorted = [...list].sort((a, b) => ms(a.at) - ms(b.at));
    for (let i = 1; i < sorted.length; i++) {
      if (ms(sorted[i].at) - ms(sorted[i - 1].at) <= 5 * MIN) hits.add(sorted[i].customerId);
    }
  }
  return [...hits];
}

const DETECTORS: Record<Signature, (db: Readonly<Db>) => string[]> = {
  cancel_not_synced: cancelNotSynced,
  entitlement_grant_failed: entitlementGrantFailed,
  duplicate_charge: duplicateCharge,
};

export function findBySignature(db: Readonly<Db>, signature: Signature): string[] {
  return DETECTORS[signature](db).sort();
}
