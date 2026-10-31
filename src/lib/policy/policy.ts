/** Human-readable policy. Shown to the model AND the agent; enforced by gate.ts, not by the prompt. */
export const POLICY_RULES = {
  "1.1": "Actions may only target an existing customer.",
  "1.2": "A refund must reference a charge that belongs to the same customer.",
  "2.1": "A charge made after the customer's cancellation request is refunded automatically (up to $50).",
  "2.2": "Any other refund of a charge from the last 14 days needs agent approval.",
  "2.3": "Refunds above $50 or above the original charge amount are never issued.",
  "2.4": "A charge can be refunded only once.",
  "2.5": "Charges older than 14 days are not refundable by support.",
  "3.1": "Cancelling an active subscription on the customer's request is automatic.",
  "3.2": "A subscription can only be cancelled if it is active and belongs to the customer.",
  "4.1": "A goodwill credit of 1 month needs agent approval.",
  "4.2": "Goodwill credits above 1 month are never issued by support.",
  "5.1": "Remediating customers who have not contacted us always needs agent approval; each item is re-checked individually.",
} as const;

export type RuleId = keyof typeof POLICY_RULES;

export const MAX_AUTO_REFUND_USD = 50;
export const REFUND_WINDOW_DAYS = 14;

export function policyText(): string {
  return Object.entries(POLICY_RULES)
    .map(([id, text]) => `§${id} ${text}`)
    .join("\n");
}
