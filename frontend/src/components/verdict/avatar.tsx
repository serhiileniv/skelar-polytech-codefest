import Image from "next/image";

import { cn } from "@/lib/utils";

import { SUPPORT_AVATAR_SRC, avatarSrc, initials } from "./avatar-src";

const SIZE_CLASS = {
  28: "size-7 text-[11px]",
  32: "size-8 text-[11px]",
  40: "size-10 text-[13px]",
} as const;

type AvatarSize = keyof typeof SIZE_CLASS;

const FRAME =
  "flex shrink-0 items-center justify-center overflow-hidden rounded-full ring-1 ring-zinc-900/[.06]";

/** Customer avatar: bundled illustration for demo customers, initials otherwise. */
export function Avatar({
  id,
  name,
  size,
}: {
  id?: string;
  name: string;
  size: AvatarSize;
}) {
  const src = avatarSrc({ id, name });
  return src ? (
    <AvatarImage src={src} size={size} />
  ) : (
    <span
      aria-hidden
      className={cn(
        FRAME,
        SIZE_CLASS[size],
        "bg-zinc-100 font-medium text-zinc-600",
      )}
    >
      {initials(name)}
    </span>
  );
}

export function SupportAvatar({ size }: { size: AvatarSize }) {
  return <AvatarImage src={SUPPORT_AVATAR_SRC} size={size} />;
}

function AvatarImage({ src, size }: { src: string; size: AvatarSize }) {
  return (
    <span aria-hidden className={cn(FRAME, SIZE_CLASS[size])}>
      <Image src={src} alt="" width={size} height={size} />
    </span>
  );
}

/** Verdict brand mark: accent rounded square with a "V" glyph. */
export function VerdictMark({ size = 20 }: { size?: 16 | 20 }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center bg-indigo-600 leading-none font-semibold text-white",
        size === 20
          ? "size-5 rounded-[5px] text-[11px]"
          : "size-4 rounded-[4px] text-[9.5px]",
      )}
    >
      V
    </span>
  );
}
