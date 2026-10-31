import type { InvestigateEvent, ToolName, Verdict } from "@/api";

export type ToolRowState =
  "input-available" | "output-available" | "output-error";

export type TraceItem =
  | { kind: "text"; key: string; step: number; text: string }
  | {
      kind: "tool";
      key: string;
      step: number;
      name: ToolName;
      state: ToolRowState;
      output?: unknown;
      errorText?: string;
    };

export interface TraceState {
  items: TraceItem[];
  verdict: Verdict | null;
  replay: boolean;
  error: string | null;
  steps: number;
  /** True once any event arrived for the current run. */
  started: boolean;
}

export type TraceAction = InvestigateEvent | { event: "reset" };

export const INITIAL_TRACE: TraceState = {
  items: [],
  verdict: null,
  replay: false,
  error: null,
  steps: 0,
  started: false,
};

export function traceReducer(
  state: TraceState,
  action: TraceAction,
): TraceState {
  if (action.event === "reset") return INITIAL_TRACE;
  const s = { ...state, started: true };
  switch (action.event) {
    case "start":
      return { ...s, replay: action.data.replay };
    case "step":
      return { ...s, steps: action.data.n };
    case "text": {
      const last = s.items[s.items.length - 1];
      if (last?.kind === "text" && last.step === s.steps) {
        return {
          ...s,
          items: [
            ...s.items.slice(0, -1),
            { ...last, text: last.text + action.data.delta },
          ],
        };
      }
      const item: TraceItem = {
        kind: "text",
        key: `text-${s.items.length}`,
        step: s.steps,
        text: action.data.delta,
      };
      return { ...s, items: [...s.items, item] };
    }
    case "tool_call": {
      const { callId, tool } = action.data;
      const item: TraceItem = {
        kind: "tool",
        key: callId,
        step: s.steps,
        name: tool,
        state: "input-available",
      };
      return { ...s, items: [...s.items, item] };
    }
    case "tool_result": {
      const { callId, output } = action.data;
      return {
        ...s,
        items: s.items.map((i) =>
          i.kind === "tool" && i.key === callId
            ? { ...i, state: "output-available", output }
            : i,
        ),
      };
    }
    case "verdict":
      return { ...s, verdict: action.data.verdict };
    case "error":
      return {
        ...s,
        error: action.data.message,
        items: s.items.map((i) =>
          i.kind === "tool" && i.state === "input-available"
            ? { ...i, state: "output-error" }
            : i,
        ),
      };
    case "done":
      return s;
  }
}
