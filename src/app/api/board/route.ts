import { connection } from "next/server";
import { getDb } from "@/lib/domain/store";

export async function GET(): Promise<Response> {
  await connection(); // in-memory demo state: never prerender
  return Response.json(getDb().techIssues);
}
