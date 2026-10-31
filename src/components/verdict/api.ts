import type { ActionRequest, ActionResult, CaseDetail, CaseListItem, TechIssue } from "@/lib/api-contract";

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) throw new Error(`${init?.method ?? "GET"} ${url} → ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  listCases: () => request<CaseListItem[]>("/api/cases"),
  getCase: (id: string) => request<CaseDetail>(`/api/cases/${id}`),
  reply: (id: string, body: string) =>
    request<CaseDetail>(`/api/cases/${id}/reply`, { method: "POST", body: JSON.stringify({ body }) }),
  action: (id: string, req: ActionRequest) =>
    request<ActionResult>(`/api/cases/${id}/actions`, { method: "POST", body: JSON.stringify(req) }),
  board: () => request<TechIssue[]>("/api/board"),
  reset: () => request<{ reset: true }>("/api/state", { method: "DELETE" }),
};

export const investigateUrl = (id: string) => `/api/cases/${id}/investigate`;
