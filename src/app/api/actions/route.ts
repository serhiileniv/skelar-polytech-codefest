import { z } from "zod";
import { getDb } from "@/lib/domain/store";
import { approvePending, rejectPending } from "@/lib/policy/execute";

const bodySchema = z.object({
  pendingId: z.string().min(1).max(64),
  decision: z.enum(["approve", "reject"]),
});

/** Human-in-the-loop endpoint. The gate is re-run on approval, so a blocked action can't be forced here. */
export async function POST(req: Request): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid body" }, { status: 400 });
  const db = getDb();
  try {
    if (parsed.data.decision === "reject") {
      rejectPending(db, parsed.data.pendingId);
      return Response.json({ status: "rejected" });
    }
    return Response.json(approvePending(db, parsed.data.pendingId));
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "failed" }, { status: 409 });
  }
}

export async function GET(): Promise<Response> {
  return Response.json(getDb().pending);
}
