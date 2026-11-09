import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

export type FullscreenStepProps = {
  title: string;
  children: ReactNode;
  /** Одно главное действие шага («Далее»); под ним — второстепенные. null — у шага нет действия (ждём проверки). */
  action: ReactNode;
  /** «Назад» видна всегда: ссылка или обработчик. */
  back: { href: string } | { onClick: () => void };
  /** Шкала шагов между «Назад» и заголовком (мастер заявки, регистрация). */
  progress?: ReactNode;
  /** Заголовок шага: на него переводят фокус при смене шага (вход: возврат от кода к номеру). */
  titleRef?: Ref<HTMLHeadingElement>;
  className?: string;
};

const backClass =
  "-ml-2 inline-flex min-h-control-sm items-center gap-1 self-start rounded-control pr-3 pl-1 text-base font-semibold text-ink no-underline hover:bg-surface";

/**
 * Один вопрос — одна кнопка (TikTok/Reels): «Назад», крупный заголовок, содержимое, действие внизу.
 * Только на телефоне (< 640 px) шаг тянется до низа окна и прижимает действие к нижней панели: высота окна минус
 * нижняя панель (--tabbar-h) и запас на шапку, демо-плашку и отступы — второстепенная кнопка под главной не уходит
 * за край. На планшете и компьютере действие идёт сразу под полями, без пустого разрыва.
 */
export function FullscreenStep({ title, children, action, back, progress, titleRef, className }: FullscreenStepProps) {
  const backContent = (
    <>
      <ChevronLeft aria-hidden className="size-6 shrink-0" />
      {ru.common.actions.back}
    </>
  );
  return (
    <section className={cn("flex flex-col gap-5 max-sm:min-h-[calc(100dvh-var(--tabbar-h)-11rem)]", className)}>
      {"href" in back ? (
        <Link href={back.href} className={backClass}>
          {backContent}
        </Link>
      ) : (
        <button type="button" onClick={back.onClick} className={cn(backClass, "bg-transparent")}>
          {backContent}
        </button>
      )}
      {progress}
      <h1 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="rounded-control text-2xl font-extrabold break-words text-ink sm:text-3xl">
        {title}
      </h1>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
      {action && <div className="mt-auto flex flex-col gap-3 pt-2">{action}</div>}
    </section>
  );
}
