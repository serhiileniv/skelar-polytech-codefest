import type { ApiClient } from "./client";
import { createHttpClient } from "./http";
import { createMockClient } from "./mock/client";

export type { ApiClient } from "./client";
export { ApiRequestError } from "./errors";
export type * from "./types";

const DEFAULT_API_URL = "http://localhost:8080";

/** `NEXT_PUBLIC_API_MODE=http` → Go API at `NEXT_PUBLIC_API_URL`; anything else → in-browser mock. */
export const api: ApiClient =
  process.env.NEXT_PUBLIC_API_MODE === "http"
    ? createHttpClient(process.env.NEXT_PUBLIC_API_URL ?? DEFAULT_API_URL)
    : createMockClient();

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
