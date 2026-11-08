import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type FullscreenStepProps = {
  title: string;
  children: ReactNode;
  /** Одно главное действие шага («Далее»). */
  action: ReactNode;
  /** «Назад» видна всегда: ссылка или обработчик. */
  back: { href: string } | { onClick: () => void };
  className?: string;
};

const backClass =
  "-ml-2 inline-flex min-h-control-sm items-center gap-1 self-start rounded-control pr-3 pl-1 text-base font-semibold text-ink no-underline hover:bg-surface";

/** Один вопрос — одна кнопка (TikTok/Reels): «Назад», крупный заголовок, содержимое, действие внизу. */
export function FullscreenStep({ title, children, action, back, className }: FullscreenStepProps) {
  const backContent = (
    <>
      <ChevronLeft aria-hidden className="size-6 shrink-0" />
      {ru.common.ui.fullscreen.back}
    </>
  );
  return (
    <section className={cn("flex min-h-[calc(100dvh-8rem)] flex-col gap-5", className)}>
      {"href" in back ? (
        <Link href={back.href} className={backClass}>
          {backContent}
        </Link>
      ) : (
        <button type="button" onClick={back.onClick} className={cn(backClass, "bg-transparent")}>
          {backContent}
        </button>
      )}
      <h1 className="text-2xl font-extrabold break-words text-ink">{title}</h1>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      <div className="mt-auto flex flex-col gap-3 pt-2">{action}</div>
    </section>
  );
}
