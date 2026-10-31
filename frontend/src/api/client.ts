import type {
  ActionRequest,
  ActionResult,
  CaseDetail,
  CaseListItem,
  InvestigateEvent,
  Metrics,
  TechIssue,
} from "./types";

/** Everything the UI can ask of the backend. Implemented by `http` (Go API) and `mock` (in-browser). */
export interface ApiClient {
  readonly mode: "http" | "mock";
  listCases(): Promise<CaseListItem[]>;
  getCase(id: string): Promise<CaseDetail>;
  reply(id: string, body: string): Promise<CaseDetail>;
  action(id: string, req: ActionRequest): Promise<ActionResult>;
  board(): Promise<TechIssue[]>;
  metrics(): Promise<Metrics>;
  reset(): Promise<{ reset: true }>;
  /** Streams the agent loop; resolves after `done`. Rejects with `ApiRequestError` if the request itself fails. */
  investigate(
    id: string,
    onEvent: (e: InvestigateEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
}
