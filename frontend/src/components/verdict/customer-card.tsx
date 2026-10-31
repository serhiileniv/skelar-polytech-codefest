import type { CaseDetail } from "@/api";
import { cn } from "@/lib/utils";

import { Avatar } from "./avatar";
import { HIGHLIGHT_CLASS, useEvidenceTarget } from "./evidence-focus";
import { IdChip } from "./outcome-badge";
import { formatDate } from "./time";
import { platformLabel } from "./verdict-text";

interface CustomerCardProps {
  detail: CaseDetail;
}

export function CustomerCard({ detail }: CustomerCardProps) {
  const { customer, subscriptions, payments, entitlements } = detail;
  const activeSub =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="space-y-4">
        <div className="flex items-start gap-3">
          <Avatar id={customer.id} name={customer.name} size={40} />
          <div className="min-w-0 self-center">
            <div className="truncate text-[13px] leading-5 font-semibold text-zinc-900">
              {customer.name}
            </div>
            <div className="truncate text-[12px] leading-4 text-zinc-500">
              {customer.email}
            </div>
          </div>
          <code className="ml-auto shrink-0 font-mono text-[11.5px] leading-4 text-zinc-500">
            {customer.id}
          </code>
        </div>

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px] leading-5">
          <Fact label="Plan">
            {activeSub ? `${activeSub.plan} · $${activeSub.priceUsd}` : "Free"}
          </Fact>
          <Fact label="Platform">{platformLabel(customer.platform)}</Fact>
          <Fact label="App">v{customer.appVersion}</Fact>
        </dl>

        <Section title="Subscriptions" count={subscriptions.length}>
          {subscriptions.map((s) => (
            <Row key={s.id} id={s.id}>
              <span>
                {s.channel === "app_store" ? "App Store" : "Web"} · {s.plan}
              </span>
              <Pill tone={s.status === "canceled" ? "bad" : "good"}>
                {s.status}
              </Pill>
              <span className="ml-auto text-[12px] text-zinc-500 tabular-nums">
                {s.status === "active"
                  ? `renews ${formatDate(s.renewsAt)}`
                  : `canceled ${formatDate(s.canceledAt)}`}
              </span>
            </Row>
          ))}
        </Section>

        <Section title="Payments" count={payments.length}>
          {payments.map((p) => (
            <Row key={p.id} id={p.id}>
              <span className="tabular-nums">${p.amountUsd.toFixed(2)}</span>
              <Pill
                tone={
                  p.status === "succeeded"
                    ? "good"
                    : p.status === "failed"
                      ? "bad"
                      : "muted"
                }
              >
                {p.status}
              </Pill>
              <span className="ml-auto text-[12px] text-zinc-500 tabular-nums">
                {formatDate(p.at)}
              </span>
            </Row>
          ))}
        </Section>

        <Section title="Entitlements" count={entitlements.length}>
          {entitlements.map((e) => (
            <Row key={e.id} id={e.id}>
              <span className="truncate">Premium</span>
              <Pill tone={e.active ? "good" : "bad"}>
                {e.active ? "active" : "inactive"}
              </Pill>
              <span className="ml-auto truncate text-[12px] text-zinc-500">
                {e.accountEmail}
              </span>
            </Row>
          ))}
        </Section>
      </div>
    </div>
  );
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="truncate text-zinc-900">{children}</dd>
    </>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-zinc-100 pt-3">
      <div className="mb-1.5 text-[12px] leading-4 font-medium text-zinc-500">
        {title} <span className="tabular-nums">({count})</span>
      </div>
      {count === 0 ? (
        <div className="text-[12px] text-zinc-400">None</div>
      ) : (
        <ul className="space-y-0.5">{children}</ul>
      )}
    </section>
  );
}

function Row({ id, children }: { id: string; children: React.ReactNode }) {
  const { attrs, highlighted } = useEvidenceTarget([id]);
  return (
    <li
      {...attrs}
      className={cn(
        "-mx-1.5 flex scroll-mt-4 items-center gap-2 rounded-md px-1.5 py-1 text-[13px] leading-5 text-zinc-700 transition-colors duration-200 motion-reduce:transition-none",
        highlighted && HIGHLIGHT_CLASS,
      )}
    >
      <IdChip id={id} />
      {children}
    </li>
  );
}

/** Normal states stay neutral; only problems ("bad") get colour, as text. */
const PILL_TONE = {
  good: "text-zinc-500",
  bad: "font-medium text-[#b42318]",
  muted: "text-zinc-500",
} as const;

function Pill({
  tone,
  children,
}: {
  tone: keyof typeof PILL_TONE;
  children: React.ReactNode;
}) {
  return (
    <span className={cn("text-[12px] leading-4", PILL_TONE[tone])}>
      {children}
    </span>
  );
}
