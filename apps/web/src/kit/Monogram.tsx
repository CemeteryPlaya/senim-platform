import { UserRound } from "lucide-react";
import { cn } from "./cn";

/**
 * Текст монограммы по имени: номер исполнителя — «№8» (из «Исполнитель №8»: имя скрыто, номер — то, что человек видит);
 * номер из трёх и более цифр — без знака «№» («1042»): иначе не влезает в круг 36 px. Иначе первые буквы двух первых
 * слов («Айгерим Сапарова» → «АС»). Пустое имя — null (рисуется значок человека).
 */
export function monogramOf(name: string | null | undefined): string | null {
  const text = (name ?? "").trim();
  const number = /№\s*(\d+)/.exec(text);
  if (number) return number[1].length >= 3 ? number[1] : `№${number[1]}`;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  return words
    .slice(0, 2)
    .map((word) => word[0].toLocaleUpperCase("ru"))
    .join("");
}

export type MonogramSize = "sm" | "md" | "lg";

/** 36 px — шапка; 44 px — строки чатов и списков; 72 px — профиль мастера (разбор 3.6). */
const BOXES: Record<MonogramSize, string> = { sm: "size-avatar", md: "size-avatar-md", lg: "size-avatar-lg" };
const TEXT: Record<MonogramSize, string> = { sm: "text-sub", md: "text-headline", lg: "text-title-2" };

/** Длинная монограмма (4+ знака: «1042») — кегль на ступень меньше, чтобы влезть в круг с полями. */
const LONG_TEXT: Record<MonogramSize, string> = { sm: "text-small", md: "text-sub", lg: "text-headline" };
const LONG = 4;

const ICONS: Record<MonogramSize, string> = { sm: "size-5", md: "size-6", lg: "size-9" };

export type MonogramProps = {
  /** Имя или публичная подпись («Исполнитель №8»); монограмма строится из него (`monogramOf`). */
  name: string | null | undefined;
  size?: MonogramSize;
  className?: string;
};

/**
 * Аватар-монограмма: круг с заливкой `fill`, текст `ink` 600 (ink на fill — 4,5:1 и выше, contrast.test.ts). Без фото
 * людей: для исполнителя до оферты — номер («№8»), имя скрыто (ADR-006). Украшение — скрыто от диктора: имя человека
 * стоит рядом текстом или в подписи кнопки. Серверный компонент.
 */
export function Monogram({ name, size = "sm", className }: MonogramProps) {
  const text = monogramOf(name);
  return (
    <span
      aria-hidden
      data-monogram
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-fill font-semibold text-ink tabular-nums",
        BOXES[size],
        text !== null && text.length >= LONG ? LONG_TEXT[size] : TEXT[size],
        className,
      )}
    >
      {text ?? <UserRound className={ICONS[size]} />}
    </span>
  );
}
