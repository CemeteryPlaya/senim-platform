import type { ReactNode } from "react";
import type { RequestDetails } from "@/modules/requests/client";
import { ru } from "@/i18n/ru";
import { COUNTERTOPS, FACADES, HARDWARE, STYLES, type StyleKey } from "@/verticals/furniture";

const f = ru.requests.facts;

export type FactRow = { label: string; value: ReactNode; edit?: ReactNode };

/** Ответы мастера списком «название — значение»; «не знаю» показано явно. Без хуков: годится и серверу, и клиенту. */
export function detailRows(input: { title: string; style: string | null; details: RequestDetails }): FactRow[] {
  const { details: d } = input;
  const unknown = new Set(d.unknown ?? []);
  const material = (key: "facade" | "countertop" | "hardware", value: string | undefined, names: Record<string, { name: string }>) =>
    unknown.has(key) ? f.unknown : value ? names[value].name : null;
  const size = unknown.has("size") ? f.unknown : d.widthCm || d.heightCm || d.depthCm ? f.sizeValue(d.widthCm, d.heightCm, d.depthCm) : null;

  const rows: (FactRow | null)[] = [
    { label: f.type, value: input.title },
    input.style ? { label: f.style, value: STYLES[input.style as StyleKey]?.name ?? input.style } : null,
    d.styleNote ? { label: f.styleNote, value: d.styleNote } : null,
    size ? { label: f.size, value: size } : null,
    row(f.facade, material("facade", d.facade, FACADES)),
    row(f.countertop, material("countertop", d.countertop, COUNTERTOPS)),
    row(f.hardware, material("hardware", d.hardware, HARDWARE)),
    d.color ? { label: f.color, value: d.color } : null,
    d.extras?.length ? { label: f.extras, value: d.extras.map((x) => ru.requests.extras[x]).join(", ") } : null,
    d.description ? { label: f.description, value: d.description } : null,
  ];
  return rows.filter((r): r is FactRow => r !== null);
}

function row(label: string, value: string | null): FactRow | null {
  return value ? { label, value } : null;
}

/** Список фактов заявки. */
export function FactList({ rows }: { rows: readonly FactRow[] }) {
  return (
    <dl className="facts gap-x-6 gap-y-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      {rows.map((r) => (
        <div key={r.label} className="contents">
          <dt className="text-base text-muted">{r.label}</dt>
          <dd className="flex min-w-0 flex-wrap items-start justify-between gap-2 text-base break-words text-ink">
            <span className="min-w-0">{r.value}</span>
            {r.edit}
          </dd>
        </div>
      ))}
    </dl>
  );
}
