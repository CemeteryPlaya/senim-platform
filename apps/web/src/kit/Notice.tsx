import type { ReactNode } from "react";
import { cn } from "./cn";

export type NoticeTone = "info" | "warn" | "danger";

/** Пары «текст / подложка» — те же, что у StatusChip, поэтому контраст уже проверен (contrast.test.ts). */
const TONES: Record<NoticeTone, string> = {
  info: "bg-accent-soft text-accent",
  warn: "bg-warn-soft text-warn",
  danger: "bg-danger-soft text-danger",
};

export type NoticeProps = {
  tone: NoticeTone;
  /** Короткий заголовок (17 px / 600); без него — только текст. */
  title?: string;
  /** Появляется после загрузки страницы (ответ сервера, сбой): `role="alert"`, диктор читает сразу. */
  live?: boolean;
  children: ReactNode;
};

/**
 * Сообщение в потоке страницы: плашка радиуса карточки, текст 17 px, цвет по тону. Не всплывает и не закрывается;
 * что делать дальше, говорит текст, а не цвет. Серверный компонент.
 */
export function Notice({ tone, title, live = false, children }: NoticeProps) {
  return (
    <div role={live ? "alert" : undefined} className={cn("flex flex-col gap-1 rounded-card p-4 text-body", TONES[tone])}>
      {title && <p className="text-card">{title}</p>}
      {children}
    </div>
  );
}
