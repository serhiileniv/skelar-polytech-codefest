import { ApiRequestError } from "@/api";

/**
 * True when the client lost the stream but the server run probably goes on: a 409 "already running"
 * or a dropped connection (fetch rejects with TypeError). The panel then waits for the case poll.
 */
export function serverMayStillRun(e: unknown): boolean {
  if (e instanceof ApiRequestError) return e.status === 409;
  return e instanceof TypeError;
}
