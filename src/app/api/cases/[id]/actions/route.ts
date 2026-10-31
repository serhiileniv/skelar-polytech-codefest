import { z } from "zod";
import { getDb } from "@/lib/domain/store";
import { runAction } from "@/lib/policy/actions";
import { supportActionSchema } from "@/lib/verdict/schema";

const bodySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("support_action"), action: supportActionSchema }),
  z.object({ kind: z.literal("send_to_tech") }),
  z.object({ kind: z.literal("mark_resolved") }),
]);

/** Human-clicked actions. The policy gate runs server-side, so the client cannot bypass it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid action" }, { status: 400 });
  try {
    return Response.json(runAction(getDb(), (await params).id, parsed.data));
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "failed" }, { status: 409 });
  }
}
