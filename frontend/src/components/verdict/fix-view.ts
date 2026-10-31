import type {
  FixCapability,
  FixPlan,
  FixRunResult,
  FixStep,
  Verdict,
} from "@/api";

/** Mirrors rule F1 so the button only shows when the server would accept `POST /fix`. */
export function fixAllowed(v: Verdict): boolean {
  return (
    !v.downgraded &&
    (v.outcome === "user_can_fix" || v.outcome === "support_can_fix")
  );
}

/** Owner label in first person from the agent's view. */
export function ownerLabel(step: FixStep): string {
  switch (step.owner) {
    case "agent":
      return step.kind === "auto" && step.actor === "customer"
        ? "I'll do this for the customer"
        : "I'll do this as support";
    case "customer":
      return "Customer";
  }
}

/** Auto steps the gate would allow start checked; blocked ones start unchecked. */
export function defaultSelection(plan: FixPlan): string[] {
  return plan.steps.flatMap((s) =>
    s.kind === "auto" && s.wouldBe === "executed" ? [s.id] : [],
  );
}

export function toggleStep(selected: readonly string[], id: string): string[] {
  return selected.includes(id)
    ? selected.filter((s) => s !== id)
    : [...selected, id];
}

export interface CapabilityGroup {
  title: string;
  items: FixCapability[];
}

export function capabilityGroups(
  caps: readonly FixCapability[],
): CapabilityGroup[] {
  const groups: CapabilityGroup[] = [
    {
      title: "On behalf of the customer",
      items: caps.filter((c) => c.actor === "customer"),
    },
    {
      title: "On behalf of support",
      items: caps.filter((c) => c.actor === "support"),
    },
  ];
  return groups.filter((g) => g.items.length > 0);
}

export interface RunSummary {
  ok: boolean;
  message: string;
}

/** One line for the toast after "Approve & run". */
export function runSummary(result: FixRunResult): RunSummary {
  const executed = result.steps.filter((s) => s.status === "executed").length;
  const blocked = result.steps.find((s) => s.status === "blocked");
  if (blocked?.result)
    return {
      ok: false,
      message: `Stopped · ${blocked.result.message} · rule ${blocked.result.rule}`,
    };
  const tail = result.resolved
    ? "case resolved"
    : "case stays open for the remaining steps";
  return {
    ok: true,
    message: `Fix-it ran ${executed} ${executed === 1 ? "step" : "steps"} · ${tail}`,
  };
}

export type PlanRow =
  { kind: "step"; step: FixStep } | { kind: "reply"; body: string };

/** The plan as one ordered list; the reply (sent after the auto steps) sits right after the last auto step. */
export function planRows(plan: FixPlan): PlanRow[] {
  const rows: PlanRow[] = plan.steps.map((step) => ({ kind: "step", step }));
  const lastAuto = plan.steps.findLastIndex((s) => s.kind === "auto");
  const reply: PlanRow = { kind: "reply", body: plan.replyBody };
  return [...rows.slice(0, lastAuto + 1), reply, ...rows.slice(lastAuto + 1)];
}
