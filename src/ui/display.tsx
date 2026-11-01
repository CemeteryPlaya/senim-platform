import Link from "next/link";
import { AlertTriangle, ArrowLeft, CheckCircle2, FlaskConical, Info, OctagonAlert, Sparkles } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { cn } from "./cn";
import { formatDate, formatDateTime, formatRelative, formatTime, moneyBreakParts, type DateInput } from "./format";

// Презентационные компоненты без состояния: работают и в серверных, и в клиентских компонентах.

/** accent — мятная плашка с зелёным текстом (подсказки, «Комфорт», «Получайте предложения»). */
export type Tone = "neutral" | "accent" | "info" | "success" | "warning" | "danger";

const TONE_SOFT: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-soft",
  accent: "bg-accent-soft text-primary",
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/* ── Раскладка ─────────────────────────────────────────────── */

export type ContainerProps = { size?: "page" | "form" | "prose"; className?: string; children: ReactNode };

const CONTAINER: Record<NonNullable<ContainerProps["size"]>, string> = {
  page: "max-w-page",
  form: "max-w-form",
  prose: "max-w-prose",
};

/** Центрированная колонка с полями по краям. page — списки и панели, form — формы и мастер, prose — текст. */
export function Container({ size = "page", className, children }: ContainerProps) {
  return <div className={cn("mx-auto w-full px-4 sm:px-6", CONTAINER[size], className)}>{children}</div>;
}

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Куда ведёт «Назад». Если задан — кнопка видна всегда. */
  back?: { href: string; label?: string };
  /** Действия справа от заголовка (на телефоне — под ним). */
  actions?: ReactNode;
  className?: string;
};

/** Заголовок экрана: «Назад», h1, пояснение, действия. На странице — ровно один. */
export function PageHeader({ title, description, back, actions, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-col gap-4 pt-4 pb-6 sm:pt-6", className)}>
      {back && (
        <Link
          href={back.href}
          className="-ml-2 inline-flex min-h-control-sm items-center gap-2 self-start rounded-control px-2 text-base font-semibold text-ink no-underline hover:bg-sunken"
        >
          <ArrowLeft aria-hidden className="size-5 shrink-0" />
          {back.label ?? ru.common.actions.back}
        </Link>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">{title}</h1>
          {description && <p className="max-w-prose text-lg text-muted">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
      </div>
    </header>
  );
}

/* ── Карточка ──────────────────────────────────────────────── */

export type CardProps = {
  as?: "div" | "section" | "article" | "li";
  title?: ReactNode;
  /** Уровень заголовка карточки (по умолчанию h2). */
  titleAs?: "h2" | "h3";
  /** id заголовка: на него можно перевести фокус после действия (tabIndex=-1), карточка-section им подписана. */
  titleId?: string;
  description?: ReactNode;
  /** Кнопки внизу карточки. */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
};

/** Карточка на поверхности с тонкой рамкой. Не вкладывайте карточку в карточку. */
export function Card({ as: Tag = "div", title, titleAs: Title = "h2", titleId, description, footer, className, children }: CardProps) {
  return (
    <Tag aria-labelledby={title && titleId ? titleId : undefined} className={cn("flex flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6", className)}>
      {(title || description) && (
        <div className="flex flex-col gap-1">
          {title && (
            <Title id={titleId} tabIndex={titleId ? -1 : undefined} className="rounded-control text-xl font-bold text-ink">
              {title}
            </Title>
          )}
          {description && <p className="text-base text-muted">{description}</p>}
        </div>
      )}
      {children}
      {footer && <div className="flex flex-wrap gap-3 border-t border-line pt-4">{footer}</div>}
    </Tag>
  );
}

/* ── Статусы и сообщения ───────────────────────────────────── */

export type StatusBadgeProps = { tone?: Tone; icon?: ReactNode; className?: string; children: ReactNode };

/** Метка статуса: тон + текст. Цвет никогда не единственный носитель смысла — текст обязателен. */
export function StatusBadge({ tone = "neutral", icon, className, children }: StatusBadgeProps) {
  return (
    // max-w-full и перенос по словам: при крупном системном шрифте метка не вылезает за карточку.
    <span className={cn("inline-flex max-w-full items-center gap-1.5 rounded-full px-3 py-0.5 text-sm font-semibold break-words", TONE_SOFT[tone], className)}>
      {icon && <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-4">{icon}</span>}
      <span className="min-w-0">{children}</span>
    </span>
  );
}

export type AlertTone = Exclude<Tone, "neutral">;

const ALERT_ICON: Record<AlertTone, ReactNode> = {
  accent: <Sparkles aria-hidden className="size-6 shrink-0" />,
  info: <Info aria-hidden className="size-6 shrink-0" />,
  success: <CheckCircle2 aria-hidden className="size-6 shrink-0" />,
  warning: <AlertTriangle aria-hidden className="size-6 shrink-0" />,
  danger: <OctagonAlert aria-hidden className="size-6 shrink-0" />,
};

export type AlertProps = {
  tone?: AlertTone;
  title?: ReactNode;
  /** Кнопка или ссылка под текстом. */
  action?: ReactNode;
  /**
   * Объявить экранному диктору сразу при появлении. Для ошибок после действия — "assertive",
   * для подтверждений — "polite". Статичным сообщениям не нужно.
   */
  live?: "polite" | "assertive";
  className?: string;
  children: ReactNode;
};

/** Сообщение в потоке страницы: подсказка, успех, предупреждение, ошибка. */
export function Alert({ tone = "info", title, action, live, className, children }: AlertProps) {
  const role = live === "assertive" ? "alert" : live === "polite" ? "status" : undefined;
  return (
    <div role={role} className={cn("flex gap-3 rounded-card p-4", TONE_SOFT[tone], className)}>
      {ALERT_ICON[tone]}
      <div className="flex min-w-0 flex-col gap-1">
        {title && <p className="text-base font-bold">{title}</p>}
        <div className="text-base text-ink">{children}</div>
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  );
}

export type BannerProps = { tone?: AlertTone; icon?: ReactNode; className?: string; children: ReactNode };

/** Полоса во всю ширину над шапкой (демо-режим, технические работы). */
export function Banner({ tone = "info", icon, className, children }: BannerProps) {
  return (
    <div className={cn("w-full", TONE_SOFT[tone], className)}>
      <div className="mx-auto flex max-w-page items-center gap-2 px-4 py-2 text-sm font-semibold sm:px-6">
        {icon && <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-5">{icon}</span>}
        <span>{children}</span>
      </div>
    </div>
  );
}

/** Полоса «Демо-режим: тестовые данные». Показывать только при DEMO_MODE (решает вызывающий). */
export function DemoBanner() {
  return (
    <Banner tone="warning" icon={<FlaskConical />}>
      {ru.common.demoBadge}
    </Banner>
  );
}

/** Метка «Симулятор банка — не настоящие деньги» рядом с суммами в режиме escrow-simulator. */
export function SimulatorBadge({ className }: { className?: string }) {
  return (
    <StatusBadge tone="info" icon={<FlaskConical />} className={className}>
      {ru.common.simulatorBadge}
    </StatusBadge>
  );
}

export type EmptyStateProps = {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Одно главное действие: обычно <ButtonLink>. */
  action?: ReactNode;
  titleAs?: "h2" | "h3";
  className?: string;
};

/** Пустой список: что здесь будет и что сделать первым. */
export function EmptyState({ title, description, icon, action, titleAs: Title = "h2", className }: EmptyStateProps) {
  return (
    <div className={cn("flex flex-col items-start gap-3 rounded-card bg-sunken p-6 sm:p-8", className)}>
      {icon && <span aria-hidden className="inline-flex text-muted [&_svg]:size-8">{icon}</span>}
      <Title className="text-xl font-bold text-ink">{title}</Title>
      {description && <p className="max-w-prose text-base text-ink-soft">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Пара «название — значение» внутри <dl>. compact — мелкий текст (карточка отклика). */
export function Fact({ label, compact = false, children }: { label: string; compact?: boolean; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col", !compact && "gap-1")}>
      <dt className={cn(compact ? "text-sm" : "text-base", "text-muted")}>{label}</dt>
      <dd className={cn(compact ? "text-base font-semibold" : "text-lg", "text-ink")}>{children}</dd>
    </div>
  );
}

/* ── Деньги, даты, загрузка ────────────────────────────────── */

/**
 * Сумма в тенге: «1 250 000 ₸», цифры одной ширины. Обычно в одну строку; если не помещается
 * (крупный шрифт на телефоне) — переносится только между группами разрядов.
 */
export function Money({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)}>
      {moneyBreakParts(amount).map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <wbr />}
          {part}
        </Fragment>
      ))}
    </span>
  );
}

export type DateTextProps = {
  value: DateInput;
  /** date — «12 марта 2026», dateTime — с временем, time — «14:30», relative — «5 минут назад». */
  format?: "date" | "dateTime" | "time" | "relative";
  className?: string;
};

const DATE_FORMATS: Record<NonNullable<DateTextProps["format"]>, (v: DateInput) => string> = {
  date: formatDate,
  dateTime: formatDateTime,
  time: formatTime,
  relative: (v) => formatRelative(v),
};

/** Дата в элементе <time>; полная дата и время — во всплывающей подсказке. */
export function DateText({ value, format = "date", className }: DateTextProps) {
  const date = value instanceof Date ? value : new Date(value);
  return (
    // Относительное время на сервере и в браузере может разойтись на минуту — это нормально.
    <time dateTime={date.toISOString()} title={formatDateTime(date)} className={className} suppressHydrationWarning>
      {DATE_FORMATS[format](date)}
    </time>
  );
}

export type SkeletonProps = { lines?: number; className?: string };

/** Заглушка на время загрузки. Скрыта от диктора: рядом нужен текст «Загрузка…» или aria-busy у контейнера. */
export function Skeleton({ lines = 1, className }: SkeletonProps) {
  return (
    <div aria-hidden className={cn("flex flex-col gap-2", className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={cn("h-[1lh] rounded-control bg-sunken animate-pulse motion-reduce:animate-none", i === lines - 1 && lines > 1 && "w-2/3")}
        />
      ))}
    </div>
  );
}
