import { getDb } from "@/lib/domain/store";
import { caseDetail } from "@/lib/domain/queries";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const detail = caseDetail(getDb(), (await params).id);
  return detail ? Response.json(detail) : Response.json({ error: "case not found" }, { status: 404 });
}
