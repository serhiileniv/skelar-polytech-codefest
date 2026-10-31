import { TechBoard } from "@/components/board/tech-board";
import { TopBar } from "@/components/verdict/top-bar";

export default function BoardPage() {
  return (
    <div className="flex h-dvh flex-col bg-zinc-50 text-zinc-900">
      <TopBar />
      <TechBoard />
    </div>
  );
}
