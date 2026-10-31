import type { CaseListItem } from "@/lib/api-contract";
import { getDb } from "@/lib/domain/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const db = getDb();
  const items: CaseListItem[] = db.cases
    .map((c) => ({
      id: c.id,
      subject: c.subject,
      customerName: db.customers.find((x) => x.id === c.customerId)?.name ?? c.customerId,
      preview: c.messages.at(-1)?.body.slice(0, 120) ?? "",
      status: c.status,
      outcome: c.verdict?.outcome ?? null,
      createdAt: c.createdAt,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return Response.json(items);
}
