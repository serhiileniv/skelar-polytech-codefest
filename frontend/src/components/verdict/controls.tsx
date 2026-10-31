import { cn } from "@/lib/utils";

const FOCUS_RING =
  "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1 focus-visible:outline-none";
const PRESS =
  "transition-[background-color,color,transform] duration-100 active:scale-[.98] motion-reduce:transition-none motion-reduce:active:scale-100";

export function PrimaryButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-action="primary"
      {...props}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md bg-indigo-600 px-3 text-[13px] font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400",
        PRESS,
        FOCUS_RING,
        className,
      )}
    />
  );
}

export function SecondaryButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-800 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-white",
        PRESS,
        FOCUS_RING,
        className,
      )}
    />
  );
}

/** Low-emphasis action: Re-run, Retry, Reset demo, Mark resolved. */
export function GhostButton({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-400 disabled:hover:bg-transparent",
        PRESS,
        FOCUS_RING,
        className,
      )}
    />
  );
}

/** Policy rule id; green when the gate allows, red when it blocks. */
export function RuleChip({ rule, ok }: { rule: string; ok: boolean }) {
  return (
    <span
      title={`Policy rule ${rule}`}
      className={cn(
        "inline-flex shrink-0 items-center rounded-[4px] px-1 font-mono text-[11.5px] leading-4 font-medium",
        ok ? "bg-[#eef6f1] text-[#2f7d55]" : "bg-[#fdf0ef] text-[#b42318]",
      )}
    >
      {rule}
    </span>
  );
}

/** Section label: sentence case, no eyebrow styling. */
export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-1.5 text-[12px] leading-4 font-medium text-zinc-500">
        {label}
      </div>
      {children}
    </section>
  );
}
