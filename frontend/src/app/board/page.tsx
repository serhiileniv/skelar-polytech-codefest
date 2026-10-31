import { TechBoard } from "@/components/board/tech-board";
import { TopBar } from "@/components/verdict/top-bar";

export default function BoardPage() {
  return (
    <div className="bg-canvas flex h-dvh flex-col text-zinc-900">
      <TopBar />
      <TechBoard />
    </div>
  );
}
