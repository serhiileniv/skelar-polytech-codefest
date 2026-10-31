import { createSeed } from "./seed";
import type { Db } from "./types";

// In-memory DB survives Next dev hot reloads via globalThis. Reset with resetDb().
const g = globalThis as unknown as { __closerDb?: Db };

export function getDb(): Db {
  g.__closerDb ??= createSeed();
  return g.__closerDb;
}

export function resetDb(): Db {
  g.__closerDb = createSeed();
  return g.__closerDb;
}
