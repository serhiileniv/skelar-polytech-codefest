import type { Db } from "../domain/types";

export interface Check {
  id: "no_active_subscriptions" | "post_cancel_charges_refunded" | "no_upcoming_renewal";
  label: string;
  pass: boolean;
  detail: string;
}

export interface Verification {
  customerId: string;
  resolved: boolean;
  checks: Check[];
}

/**
 * Post-conditions for "stop charging me and give my money back", read from system state,
 * not from what the model claims it did.
 */
export function verifyCancellationResolved(db: Readonly<Db>, customerId: string): Verification {
  const subs = db.subscriptions.filter((s) => s.customerId === customerId);
  const events = db.events.filter((e) => e.customerId === customerId);
  const firstCancel = events
    .filter((e) => e.type === "cancel_request")
    .map((e) => e.at)
    .sort()[0];
  const refunded = new Set(events.filter((e) => e.type === "refund").map((e) => e.refundOf));
  const strayCharges = firstCancel
    ? events.filter((e) => e.type === "charge" && e.at > firstCancel && !refunded.has(e.id))
    : [];
  const active = subs.filter((s) => s.status === "active");
  const renewing = subs.filter((s) => s.renewsAt !== null);

  const checks: Check[] = [
    {
      id: "no_active_subscriptions",
      label: "No active subscriptions",
      pass: active.length === 0,
      detail: active.length ? `Active: ${active.map((s) => s.id).join(", ")}` : "All subscriptions cancelled",
    },
    {
      id: "post_cancel_charges_refunded",
      label: "Every charge after cancellation refunded",
      pass: strayCharges.length === 0,
      detail: strayCharges.length
        ? `Unrefunded: ${strayCharges.map((e) => e.id).join(", ")}`
        : "No unrefunded charges after cancellation",
    },
    {
      id: "no_upcoming_renewal",
      label: "No upcoming renewal",
      pass: renewing.length === 0,
      detail: renewing.length ? `Renews: ${renewing.map((s) => s.renewsAt).join(", ")}` : "Next charge: none",
    },
  ];
  return { customerId, resolved: checks.every((c) => c.pass), checks };
}
