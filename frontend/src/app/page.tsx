import { EvidenceFocusProvider } from "@/components/verdict/evidence-focus";
import { Inbox } from "@/components/verdict/inbox";
import { MetricsStrip } from "@/components/verdict/metrics-strip";
import { TopBar } from "@/components/verdict/top-bar";

export default function InboxPage() {
  return (
    <div className="flex h-dvh flex-col bg-white text-zinc-900">
      <TopBar />
      <MetricsStrip />
      <EvidenceFocusProvider>
        <Inbox />
      </EvidenceFocusProvider>
    </div>
  );
}
