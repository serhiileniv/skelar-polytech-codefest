import { resetDb } from "@/lib/domain/store";

/** Demo reset: restores the seeded world. */
export async function DELETE(): Promise<Response> {
  resetDb();
  return Response.json({ reset: true });
}
