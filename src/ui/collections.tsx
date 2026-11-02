import Link from "next/link";
import { Check, ChevronRight, Sofa } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";

// Компоненты из макетов 7–19 для списков и главных экранов. Без состояния: работают в серверных и клиентских
// компонентах. Тексты — от вызывающего, кроме служебных подписей для диктора (ru.common.ui).

/* ── Карточка с фото ───────────────────────────────────────── */

export type PhotoCardProps = {
  /** Карточка целиком ведёт сюда (ссылка — на заголовке, зона нажатия растянута на карточку). */
  href?: string;
  /** Доступное имя ссылки, если видимого заголовка мало: «Открыть: Заявка №19». Начинается с видимого текста. */
  linkLabel?: string;
  /**
   * Фото: работа, помещение, пример. Нет фото — спокойная заглушка со значком. alt по умолчанию пустой:
   * карточку называет заголовок; описывайте фото, только если на нём есть то, чего нет в тексте.
   */
  image?: { src: string; alt?: string } | null;
  title: ReactNode;
  titleAs?: "h2" | "h3";
  /** Метка статуса рядом с заголовком (StatusBadge). */
  badge?: ReactNode;
  /** Строки подробностей: город, срок, размеры. Каждая — отдельной строкой, значок по желанию. */
  meta?: readonly { icon?: ReactNode; text: ReactNode }[];
  /** Крупная строка внизу: цена, «Осталось 13 дней». */
  aside?: ReactNode;
  /** Кнопки под карточкой — вне ссылки, нажимаются отдельно. */
  footer?: ReactNode;
  /** stacked — фото сверху (лента «Вдохновение», плитки); row — фото слева (списки заявок и заказов из макетов). */
  layout?: "stacked" | "row";
  as?: "div" | "li" | "article";
  className?: string;
};

/** Карточка с крупным фото по макетам 12–17: фото, заголовок, метка, строки подробностей, цена. */
export function PhotoCard({ href, linkLabel, image, title, titleAs: Title = "h3", badge, meta, aside, footer, layout = "stacked", as: Tag = "div", className }: PhotoCardProps) {
  const row = layout === "row";
  return (
    <Tag
      className={cn(
        "group/card relative flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card",
        href && "transition-shadow duration-150 hover:shadow-raised has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus",
        className,
      )}
    >
      <div className={cn("flex min-w-0 flex-col", row && "@container/card flex-row gap-3 p-3 sm:gap-4 sm:p-4")}>
        <Photo image={image} className={row ? "aspect-square w-24 shrink-0 self-start rounded-control @max-[18em]/card:hidden sm:w-32" : "aspect-[4/3] w-full"} />
        <div className={cn("flex min-w-0 flex-1 flex-col gap-2", !row && "p-4 sm:p-5")}>
          <div className="flex min-w-0 flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <Title className="min-w-0 text-lg leading-snug font-bold text-ink">
              {href ? (
                <Link
                  href={href}
                  aria-label={linkLabel}
                  className="rounded-control text-ink no-underline outline-none after:absolute after:inset-0 after:content-[''] hover:underline"
                >
                  {title}
                </Link>
              ) : (
                title
              )}
            </Title>
            {badge}
          </div>
          {meta && meta.length > 0 && (
            <ul className="flex flex-col gap-1 text-base text-muted">
              {meta.map((line, i) => (
                <li key={i} className="flex min-w-0 items-start gap-2">
                  {line.icon && <span aria-hidden className="mt-0.5 inline-flex shrink-0 [&_svg]:size-5">{line.icon}</span>}
                  <span className="min-w-0">{line.text}</span>
                </li>
              ))}
            </ul>
          )}
          {aside && <div className="mt-auto pt-1 text-lg font-bold text-ink">{aside}</div>}
        </div>
        {href && row && <ChevronRight aria-hidden className="size-6 shrink-0 self-center text-muted" />}
      </div>
      {footer && <div className="relative z-10 flex flex-wrap gap-3 px-4 pb-4 sm:px-5 sm:pb-5">{footer}</div>}
    </Tag>
  );
}

/** Фото или заглушка того же размера: сетка не прыгает, пока фото нет. */
function Photo({ image, className }: { image: PhotoCardProps["image"]; className: string }) {
  if (!image) {
    return (
      <div aria-hidden className={cn("flex items-center justify-center bg-sunken text-muted", className)}>
        <Sofa className="size-10" />
      </div>
    );
  }
  return (
    // Фото из хранилища и портфолио: размеры заранее неизвестны, оптимизация next/image здесь не нужна.
    // eslint-disable-next-line @next/next/no-img-element
    <img src={image.src} alt={image.alt ?? ""} loading="lazy" className={cn("bg-sunken object-cover", className)} />
  );
}

/* ── Чипы-фильтры ──────────────────────────────────────────── */

export type FilterChip = {
  key: string;
  label: string;
  /** Число в чипе: «Все 12». */
  count?: number;
  /** Фильтр через адрес (серверная страница). Без href чип — кнопка, выбор — через onSelect. */
  href?: string;
};

export type FilterChipsProps = {
  /** Подпись группы для диктора: «Показать заявки». */
  label: string;
  chips: readonly FilterChip[];
  /** key выбранного чипа. */
  current: string;
  /** Для чипов без href (клиентский компонент). */
  onSelect?: (key: string) => void;
  className?: string;
};

/**
 * Чипы-фильтры по макетам 12–15: выбранный — зелёный с белым текстом, остальные — белые с рамкой; число —
 * в кружке. Переносятся на новую строку, а не прокручиваются вбок: при крупном шрифте всё остаётся на виду.
 * Ссылки отмечают выбранный aria-current="page", кнопки — aria-pressed.
 */
export function FilterChips({ label, chips, current, onSelect, className }: FilterChipsProps) {
  const chipClass = (selected: boolean) =>
    cn(
      "inline-flex min-h-control-sm items-center gap-2 rounded-chip border px-4 text-base font-semibold no-underline transition-colors duration-150",
      selected ? "border-primary bg-primary text-on-primary hover:bg-primary-hover" : "border-line bg-surface text-ink hover:border-line-strong",
    );
  const countClass = (selected: boolean) =>
    cn("inline-flex min-w-7 justify-center rounded-full px-2 text-sm leading-6 tabular-nums", selected ? "bg-surface text-primary" : "bg-sunken text-ink");
  const body = (chip: FilterChip, selected: boolean) => (
    <>
      <span>{chip.label}</span>
      {chip.count !== undefined && <span className={countClass(selected)}>{chip.count}</span>}
    </>
  );

  return (
    <nav aria-label={label} className={className}>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => {
          const selected = chip.key === current;
          return (
            <li key={chip.key}>
              {chip.href ? (
                <Link href={chip.href} aria-current={selected ? "page" : undefined} className={chipClass(selected)}>
                  {body(chip, selected)}
                </Link>
              ) : (
                <button type="button" aria-pressed={selected} onClick={() => onSelect?.(chip.key)} className={chipClass(selected)}>
                  {body(chip, selected)}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/* ── Список-меню ───────────────────────────────────────────── */

export type LinkListItem = {
  href: string;
  label: ReactNode;
  /** Значок слева (lucide-react). */
  icon?: ReactNode;
  description?: ReactNode;
  /** Справа перед стрелкой: число, сумма. */
  meta?: ReactNode;
  /** Главный пункт списка — зелёная строка («Новые заявки» в макете 12). Один на список. */
  highlight?: boolean;
};

/** Список разделов в белой карточке (макеты 12 и 19): значок, подпись, число справа, стрелка. */
export function LinkList({ items, label, className }: { items: readonly LinkListItem[]; label?: string; className?: string }) {
  return (
    <ul aria-label={label} className={cn("flex flex-col overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-card", className)}>
      {items.map((item, i) => (
        <li key={item.href} className={cn(i > 0 && !item.highlight && !items[i - 1]?.highlight && "border-t border-line")}>
          <Link
            href={item.href}
            className={cn(
              "flex min-h-control items-center gap-3 rounded-control px-3 py-2 no-underline transition-colors duration-150",
              item.highlight ? "bg-primary text-on-primary hover:bg-primary-hover" : "text-ink hover:bg-sunken",
            )}
          >
            {item.icon && (
              <span aria-hidden className={cn("inline-flex shrink-0 [&_svg]:size-6", item.highlight ? "text-on-primary" : "text-primary")}>
                {item.icon}
              </span>
            )}
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-base font-semibold">{item.label}</span>
              {item.description && <span className={cn("text-sm", item.highlight ? "text-on-primary" : "text-muted")}>{item.description}</span>}
            </span>
            {item.meta !== undefined && (
              <span className={cn("shrink-0 text-base font-semibold tabular-nums", item.highlight ? "text-on-primary" : "text-ink-soft")}>{item.meta}</span>
            )}
            <ChevronRight aria-hidden className={cn("size-5 shrink-0", item.highlight ? "text-on-primary" : "text-muted")} />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/* ── Показатель ────────────────────────────────────────────── */

export type StatProps = {
  value: ReactNode;
  label: ReactNode;
  icon?: ReactNode;
  /** Плитка целиком ведёт в раздел. */
  href?: string;
  className?: string;
};

/**
 * Плитка-показатель из макета 12: крупное число и подпись. Только настоящие данные — никаких выдуманных цифр.
 * Порядок для диктора: число, затем подпись («3 Новые заявки»).
 */
export function Stat({ value, label, icon, href, className }: StatProps) {
  const body = (
    <>
      {icon && (
        <span aria-hidden className="inline-flex size-10 shrink-0 items-center justify-center rounded-control bg-accent-soft text-primary [&_svg]:size-5">
          {icon}
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="text-2xl leading-tight font-extrabold text-ink tabular-nums">{value}</span>
        <span className="text-sm text-muted">{label}</span>
      </span>
    </>
  );
  const box = "flex min-w-0 items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-card";
  return href ? (
    <Link href={href} className={cn(box, "no-underline transition-shadow duration-150 hover:shadow-raised", className)}>
      {body}
    </Link>
  ) : (
    <div className={cn(box, className)}>{body}</div>
  );
}

/* ── Вертикальная шкала ────────────────────────────────────── */

export type TimelineState = "done" | "current" | "todo";

export type TimelineItem = {
  title: ReactNode;
  description?: ReactNode;
  /** Справа: дата, «В процессе». */
  meta?: ReactNode;
  state: TimelineState;
};

/**
 * Ход дела сверху вниз (макеты 10, 14, 16): пройденные — зелёные кружки с галочкой, текущий — с зелёным ободком,
 * будущие — серые. Состояние каждого пункта есть и текстом для диктора.
 */
export function Timeline({ items, label, className }: { items: readonly TimelineItem[]; label: string; className?: string }) {
  const states = ru.common.ui.timeline;
  return (
    <ol aria-label={label} className={cn("flex flex-col", className)}>
      {items.map((item, i) => {
        const last = i === items.length - 1;
        return (
          <li key={i} aria-current={item.state === "current" ? "step" : undefined} className="relative flex gap-3 pb-5 last:pb-0">
            {!last && (
              <span
                aria-hidden
                className={cn("absolute top-8 bottom-0 left-[0.9375rem] border-l-2", item.state === "done" ? "border-primary" : "border-line")}
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                item.state === "done" && "bg-primary text-on-primary",
                item.state === "current" && "border-[0.4375rem] border-primary bg-surface ring-4 ring-accent-soft",
                item.state === "todo" && "border-2 border-line-strong bg-surface",
              )}
            >
              {item.state === "done" && <Check className="size-4" strokeWidth={3} />}
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3 pt-0.5">
              <div className="flex min-w-0 flex-col">
                <span className={cn("text-base", item.state === "todo" ? "text-muted" : "font-semibold text-ink")}>
                  {item.title}
                  <span className="sr-only">: {states[item.state]}</span>
                </span>
                {item.description && <span className="text-sm text-muted">{item.description}</span>}
              </div>
              {item.meta && <span className={cn("text-sm", item.state === "current" ? "font-semibold text-primary" : "text-muted")}>{item.meta}</span>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/* ── Заголовок раздела ─────────────────────────────────────── */

export type SectionTitleProps = {
  title: ReactNode;
  id?: string;
  as?: "h2" | "h3";
  /** Ссылка справа: «Смотреть все». */
  action?: { href: string; label: string; ariaLabel?: string };
  className?: string;
};

/** Заголовок блока с ссылкой справа, как «Чертежи и размеры — Смотреть все» в макете 8. */
export function SectionTitle({ title, id, as: Title = "h2", action, className }: SectionTitleProps) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-4 gap-y-1", className)}>
      <Title id={id} className="text-xl font-bold text-ink">
        {title}
      </Title>
      {action && (
        <Link
          href={action.href}
          aria-label={action.ariaLabel}
          className="inline-flex min-h-control-sm items-center gap-1 rounded-control text-base font-semibold text-primary no-underline hover:underline"
        >
          {action.label}
          <ChevronRight aria-hidden className="size-5 shrink-0" />
        </Link>
      )}
    </div>
  );
}
