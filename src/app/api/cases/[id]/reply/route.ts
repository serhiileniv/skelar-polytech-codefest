import { z } from "zod";
import { getDb } from "@/lib/domain/store";
import { audit } from "@/lib/policy/actions";
import { caseDetail } from "@/lib/domain/queries";

const bodySchema = z.object({ body: z.string().trim().min(1).max(3000) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "reply body required" }, { status: 400 });
  const db = getDb();
  const { id } = await params;
  const kase = db.cases.find((c) => c.id === id);
  if (!kase) return Response.json({ error: "case not found" }, { status: 404 });
  kase.messages.push({ id: `msg_r${kase.messages.length + 1}_${id}`, from: "support", body: parsed.data.body, at: db.now });
  if (kase.status === "open") kase.status = "waiting_customer";
  audit(db, id, "support", "reply", parsed.data.body.slice(0, 80));
  return Response.json(caseDetail(db, id));
}
