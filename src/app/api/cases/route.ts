import type { CaseListItem } from "@/lib/api-contract";
import { connection } from "next/server";
import { getDb } from "@/lib/domain/store";

export async function GET(): Promise<Response> {
  await connection(); // in-memory demo state: never prerender
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
