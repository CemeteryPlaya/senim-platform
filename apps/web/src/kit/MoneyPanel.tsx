import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useId, type ReactNode } from "react";
import type { Device } from "@/platform/device";
import { cn } from "./cn";
import { Explain } from "./Explain";
import { Money } from "./Money";
import { TextLink } from "./TextLink";

export type MoneyTone = "awaiting" | "protected" | "frozen" | "completed" | "refunded";

export type MoneyRow = {
  label: string;
  /** Сумма в тиынах. */
  amount: bigint;
  /** Пояснение по нажатию рядом с подписью (`Explain`: шторка на телефоне, поповер на компьютере). */
  explain?: { label: string; title: string; body: ReactNode };
};

export type MoneyPanelProps = {
  tone: MoneyTone;
  /** Что за сумма («Деньги в банке под защитой»). */
  title: string;
  /** Главная сумма в тиынах. */
  amount: bigint;
  rows?: readonly MoneyRow[];
  /** Поясняющая строка под строками. */
  note?: string;
  /** Ссылка внизу («История денег»). */
  action?: { label: string; href: string };
  /** Нужен пояснениям строк (`Explain`). */
  device: Device;
};

/**
 * Вид по тону. Зелёный мягкий фон — только у `protected` («деньги в банке под защитой»); остальные тона нейтральные
 * (`surface`), `frozen` — с предупреждением `warn`. Внутри зелёной подложки весь текст `ink` (пара muted/accent-soft в
 * светлой теме ниже 4,5:1), название — `accent` (пара проверена).
 */
const TONES: Record<MoneyTone, { box: string; title: string; divider: string }> = {
  awaiting: { box: "bg-surface", title: "text-muted", divider: "border-line" },
  protected: { box: "bg-accent-soft", title: "text-accent", divider: "border-accent/20" },
  frozen: { box: "bg-surface", title: "text-warn", divider: "border-line" },
  completed: { box: "bg-surface", title: "text-muted", divider: "border-line" },
  refunded: { box: "bg-surface", title: "text-muted", divider: "border-line" },
};

/**
 * Блок денег сделки: главная сумма крупно, строки «подпись — сумма» (у строки может быть пояснение), необязательные
 * примечание и ссылка внизу. Суммы — тиыны через `Money`, формулы здесь нет: все числа приходят из журнала денег.
 * Клиентская часть — только `Explain` внутри строк.
 */
export function MoneyPanel({ tone, title, amount, rows = [], note, action, device }: MoneyPanelProps) {
  const styles = TONES[tone];
  const titleId = useId();
  const textTone = tone === "protected" ? "text-ink" : "text-muted";
  return (
    <section aria-labelledby={titleId} className={cn("flex flex-col gap-3 rounded-card p-4", styles.box)}>
      <div className="flex flex-col gap-1">
        <p id={titleId} className={cn("flex items-center gap-2 text-sub font-medium", styles.title)}>
          {tone === "protected" && <ShieldCheck aria-hidden className="size-5 shrink-0" />}
          {tone === "frozen" && <TriangleAlert aria-hidden className="size-5 shrink-0" />}
          <span className="min-w-0">{title}</span>
        </p>
        <p className="text-title tabular-nums text-ink">
          <Money tiyn={amount} />
        </p>
      </div>
      {rows.length > 0 && (
        <dl className="flex flex-col">
          {rows.map((row, index) => (
            <div
              key={`${index}-${row.label}`}
              className={cn("flex items-baseline justify-between gap-4 py-3", index > 0 && cn("border-t", styles.divider))}
            >
              <dt className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 text-body", textTone)}>
                <span>{row.label}</span>
                {row.explain && (
                  <Explain label={row.explain.label} title={row.explain.title} device={device}>
                    {row.explain.body}
                  </Explain>
                )}
              </dt>
              <dd className="shrink-0 text-body text-ink">
                <Money tiyn={row.amount} />
              </dd>
            </div>
          ))}
        </dl>
      )}
      {note && <p className={cn("text-sub", tone === "protected" ? "text-ink" : "text-muted")}>{note}</p>}
      {action && <TextLink href={action.href}>{action.label}</TextLink>}
    </section>
  );
}
