import { Inbox } from "@/components/verdict/inbox";
import { TopBar } from "@/components/verdict/top-bar";

export default function InboxPage() {
  return (
    <div className="flex h-dvh flex-col bg-white text-zinc-900">
      <TopBar />
      <Inbox />
    </div>
  );
}
