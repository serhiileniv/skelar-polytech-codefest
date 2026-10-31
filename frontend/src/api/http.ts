import type { ApiClient } from "./client";
import { ApiRequestError, toApiError } from "./errors";
import { readSse } from "./sse";

/** Client for the Go API (`docs/api.md`). */
export function createHttpClient(baseUrl: string): ApiClient {
  const base = baseUrl.replace(/\/+$/, "");
  const path = (id: string) => `/api/cases/${encodeURIComponent(id)}`;

  async function fail(res: Response): Promise<never> {
    const body: unknown = await res.json().catch(() => null);
    throw new ApiRequestError(
      res.status,
      toApiError(body, `${res.status} ${res.statusText}`),
    );
  }

  async function request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${base}${url}`, {
      cache: "no-store",
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    if (!res.ok) return fail(res);
    return (await res.json()) as T;
  }

  const post = (body: unknown): RequestInit => ({
    method: "POST",
    body: JSON.stringify(body),
  });

  return {
    mode: "http",
    listCases: () => request("/api/cases"),
    getCase: (id) => request(path(id)),
    reply: (id, body) => request(`${path(id)}/reply`, post({ body })),
    action: (id, req) => request(`${path(id)}/actions`, post(req)),
    board: () => request("/api/board"),
    metrics: () => request("/api/metrics"),
    reset: () => request("/api/state", { method: "DELETE" }),
    async investigate(id, onEvent, signal) {
      const res = await fetch(`${base}${path(id)}/investigate`, {
        method: "POST",
        headers: { accept: "text/event-stream" },
        signal,
      });
      if (!res.ok) return fail(res);
      if (!res.body)
        throw new ApiRequestError(500, {
          code: "internal",
          message: "Empty investigate stream",
        });
      await readSse(res.body, onEvent);
    },
  };
}
