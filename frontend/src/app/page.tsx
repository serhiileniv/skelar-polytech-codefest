import { Suspense } from "react";

import { EvidenceFocusProvider } from "@/components/verdict/evidence-focus";
import { Inbox } from "@/components/verdict/inbox";
import { MetricsStrip } from "@/components/verdict/metrics-strip";
import { TopBar } from "@/components/verdict/top-bar";

export default function InboxPage() {
  return (
    <div className="bg-canvas flex h-dvh flex-col text-zinc-900">
      <TopBar />
      <MetricsStrip />
      <EvidenceFocusProvider>
        {/* Inbox reads ?case= via useSearchParams, which needs a Suspense boundary. */}
        <Suspense>
          <Inbox />
        </Suspense>
      </EvidenceFocusProvider>
    </div>
  );
}
