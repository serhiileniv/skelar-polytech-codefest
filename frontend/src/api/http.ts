import type { ApiClient } from "./client";
import { ApiRequestError, toApiError } from "./errors";
import { readSse } from "./sse";
import type { StreamEvent } from "./types";

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

  async function stream<E extends StreamEvent>(
    url: string,
    onEvent: (e: E) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(`${base}${url}`, {
      method: "POST",
      headers: { accept: "text/event-stream" },
      signal,
    });
    if (!res.ok) return fail(res);
    if (!res.body)
      throw new ApiRequestError(500, {
        code: "internal",
        message: "Empty event stream",
      });
    await readSse(res.body, onEvent);
  }

  return {
    mode: "http",
    listCases: () => request("/api/cases"),
    getCase: (id) => request(path(id)),
    reply: (id, body) => request(`${path(id)}/reply`, post({ body })),
    action: (id, req) => request(`${path(id)}/actions`, post(req)),
    board: () => request("/api/board"),
    metrics: () => request("/api/metrics"),
    reset: () => request("/api/state", { method: "DELETE" }),
    investigate: (id, onEvent, signal) =>
      stream(`${path(id)}/investigate`, onEvent, signal),
    ask: (id, question) => request(`${path(id)}/ask`, post({ question })),
    fixCapabilities: () => request("/api/fix/capabilities"),
    fix: (id, onEvent, signal) => stream(`${path(id)}/fix`, onEvent, signal),
    approveFix: (id, planId, stepIds) =>
      request(
        `${path(id)}/fix/${encodeURIComponent(planId)}/approve`,
        post({ stepIds }),
      ),
  };
}
