import type {
  ActionRequest,
  ActionResult,
  AskResult,
  CaseDetail,
  CaseListItem,
  FixCapability,
  FixEvent,
  FixRunResult,
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
  /** Asks about the stored verdict (v2). Rejects with 400 (empty / > 500 chars), 404, or 409 (no verdict yet). */
  ask(id: string, question: string): Promise<AskResult>;
  /** What Fix-it can do (v2). */
  fixCapabilities(): Promise<FixCapability[]>;
  /** Streams the Fix-it loop; ends with a `plan` event. Rejects with 409 when rule F1 refuses the case. */
  fix(
    id: string,
    onEvent: (e: FixEvent) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Runs only the selected auto steps of a plan through the gate (the human approval). */
  approveFix(
    id: string,
    planId: string,
    stepIds: string[],
  ): Promise<FixRunResult>;
}
