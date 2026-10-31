import { z } from "zod";

const id = z.string().min(1).max(64);

export const refundSchema = z.object({
  kind: z.literal("refund"),
  customerId: id,
  chargeId: id,
  amountUsd: z.number().positive().max(100_000),
  reason: z.string().min(3).max(300),
});

export const cancelSchema = z.object({
  kind: z.literal("cancel_subscription"),
  customerId: id,
  subscriptionId: id,
});

export const creditSchema = z.object({
  kind: z.literal("grant_credit"),
  customerId: id,
  months: z.number().int().positive().max(24),
  reason: z.string().min(3).max(300),
});

export const batchSchema = z.object({
  kind: z.literal("batch_remediate"),
  customerIds: z.array(id).min(1).max(500),
  rootCause: z.string().min(3).max(500),
});

export const actionSchema = z.discriminatedUnion("kind", [
  refundSchema,
  cancelSchema,
  creditSchema,
  batchSchema,
]);

export type Action = z.infer<typeof actionSchema>;
export type RefundAction = z.infer<typeof refundSchema>;
