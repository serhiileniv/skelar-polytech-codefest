import type {
  FixPlan,
  FixToolName,
  StreamEvent,
  ToolName,
  Verdict,
} from "@/api";

export type ToolRowState =
  "input-available" | "output-available" | "output-error";

export type TraceItem =
  | { kind: "text"; key: string; step: number; text: string }
  | {
      kind: "tool";
      key: string;
      step: number;
      name: ToolName | FixToolName;
      state: ToolRowState;
      output?: unknown;
      /** Record ids the tool returned; evidence chips jump here. */
      ids?: string[];
      errorText?: string;
    };

export interface TraceState {
  items: TraceItem[];
  verdict: Verdict | null;
  /** Fix-it runs end with a plan instead of a verdict. */
  plan: FixPlan | null;
  replay: boolean;
  error: string | null;
  steps: number;
  /** Step budget announced by `start`. */
  maxSteps: number;
  /** True once any event arrived for the current run. */
  started: boolean;
}

export type TraceAction = StreamEvent | { event: "reset" };

/** Fallback budget until `start` arrives; matches the backend loop cap. */
const DEFAULT_MAX_STEPS = 8;

export const INITIAL_TRACE: TraceState = {
  items: [],
  verdict: null,
  plan: null,
  replay: false,
  error: null,
  steps: 0,
  maxSteps: DEFAULT_MAX_STEPS,
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
      return {
        ...s,
        replay: action.data.replay,
        maxSteps: action.data.maxSteps || DEFAULT_MAX_STEPS,
      };
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
      const { callId, output, ids } = action.data;
      return {
        ...s,
        items: s.items.map((i) =>
          i.kind === "tool" && i.key === callId
            ? { ...i, state: "output-available", output, ids }
            : i,
        ),
      };
    }
    case "verdict":
      return { ...s, verdict: action.data.verdict };
    case "plan":
      return { ...s, plan: action.data.plan };
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

type ToolItem = Extract<TraceItem, { kind: "tool" }>;

/** One timeline node: the agent's thought (if any) and the tool it then called (if any yet). */
export interface TraceNode {
  key: string;
  thought?: string;
  tool?: ToolItem;
}

/** Pairs each thought with the next tool call; a trailing thought becomes its own node. */
export function groupSteps(items: readonly TraceItem[]): TraceNode[] {
  const nodes: TraceNode[] = [];
  let thought: { key: string; text: string } | null = null;
  for (const item of items) {
    if (item.kind === "text") {
      thought = thought
        ? { key: thought.key, text: `${thought.text}\n${item.text}` }
        : { key: item.key, text: item.text };
      continue;
    }
    nodes.push({ key: item.key, thought: thought?.text, tool: item });
    thought = null;
  }
  if (thought) nodes.push({ key: thought.key, thought: thought.text });
  return nodes;
}
