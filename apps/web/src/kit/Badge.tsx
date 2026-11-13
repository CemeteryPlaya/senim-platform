import { cn } from "./cn";

export const BADGE_MAX = 99;

/** Текст бейджа: `null` — не рисовать (0, отрицательное, не число); больше `max` — «99+». Дробное округляется вниз. */
export function badgeText(count: number, max: number = BADGE_MAX): string | null {
  if (!Number.isFinite(count)) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > max ? `${max}+` : String(whole);
}

export type BadgeProps = {
  count: number;
  /** Предел показа; выше — «99+». */
  max?: number;
  /** Положение у значка задаёт родитель (например, `absolute top-0 right-0`). */
  className?: string;
};

/**
 * Счётчик поверх значка (колокольчик, вкладка). 0 — не рисуется. Бейдж скрыт от диктора (`aria-hidden`): доступное
 * имя и число задаёт родитель — его `aria-label` или скрытый текст (`ru.app.kit.badge.unread(count)`). Подложка
 * `danger-soft`, текст `danger` (пара проверена по контрасту); не тёмная, чтобы оставить единственное тёмное пятно
 * главной кнопке. Серверный компонент.
 */
export function Badge({ count, max = BADGE_MAX, className }: BadgeProps) {
  const text = badgeText(count, max);
  if (text === null) return null;
  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-soft px-1 text-small font-semibold tabular-nums text-danger",
        className,
      )}
    >
      {text}
    </span>
  );
}
