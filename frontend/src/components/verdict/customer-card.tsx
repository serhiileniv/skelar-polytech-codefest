import { Apple, Globe, Smartphone } from "lucide-react";

import type { CaseDetail } from "@/api";
import type { Platform } from "@/api";
import { cn } from "@/lib/utils";

import { IdChip } from "./outcome-badge";
import { formatDate } from "./time";

interface CustomerCardProps {
  detail: CaseDetail;
}

const PLATFORM_ICON: Record<Platform, typeof Globe> = {
  web: Globe,
  ios: Apple,
  android: Smartphone,
};

export function CustomerCard({ detail }: CustomerCardProps) {
  const { customer, subscriptions, payments, entitlements } = detail;
  const PlatformIcon = PLATFORM_ICON[customer.platform];
  const activeSub =
    subscriptions.find((s) => s.status === "active") ?? subscriptions[0];

  return (
    <div className="space-y-3 border-b border-zinc-200 p-4">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[13px] font-semibold text-zinc-600">
          {initials(customer.name)}
        </div>
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">
            {customer.name}
          </div>
          <div className="truncate text-xs text-zinc-500">{customer.email}</div>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2 text-xs">
        <Fact label="Plan">
          {activeSub ? `${activeSub.plan} · $${activeSub.priceUsd}` : "Free"}
        </Fact>
        <Fact label="Platform">
          <span className="inline-flex items-center gap-1">
            <PlatformIcon className="size-3" />
            {customer.platform}
          </span>
        </Fact>
        <Fact label="App">v{customer.appVersion}</Fact>
      </dl>

      <Section title="Subscriptions" count={subscriptions.length}>
        {subscriptions.map((s) => (
          <Row key={s.id} id={s.id}>
            <span>
              {s.channel === "app_store" ? "App Store" : "Web"} · {s.plan}
            </span>
            <Pill tone={s.status === "active" ? "good" : "muted"}>
              {s.status}
            </Pill>
            <span className="ml-auto text-zinc-400">
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
            <span className="ml-auto text-zinc-400">{formatDate(p.at)}</span>
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
            <span className="ml-auto truncate text-zinc-400">
              {e.accountEmail}
            </span>
          </Row>
        ))}
      </Section>
    </div>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function Fact({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md bg-zinc-50 px-2 py-1.5">
      <dt className="text-[10px] tracking-wide text-zinc-400 uppercase">
        {label}
      </dt>
      <dd className="mt-0.5 truncate font-medium text-zinc-800 capitalize">
        {children}
      </dd>
    </div>
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
    <div>
      <div className="mb-1 text-[10px] font-medium tracking-wide text-zinc-400 uppercase">
        {title} <span className="tabular-nums">· {count}</span>
      </div>
      {count === 0 ? (
        <div className="text-xs text-zinc-400">None</div>
      ) : (
        <ul className="space-y-1">{children}</ul>
      )}
    </div>
  );
}

function Row({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5 text-xs text-zinc-700">
      <IdChip id={id} />
      {children}
    </li>
  );
}

const PILL_TONE = {
  good: "bg-emerald-50 text-emerald-700",
  bad: "bg-red-50 text-red-700",
  muted: "bg-zinc-100 text-zinc-500",
} as const;

function Pill({
  tone,
  children,
}: {
  tone: keyof typeof PILL_TONE;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "rounded px-1 py-px text-[10.5px] font-medium",
        PILL_TONE[tone],
      )}
    >
      {children}
    </span>
  );
}
