import { getDb } from "@/lib/domain/store";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return Response.json(getDb().techIssues);
}
