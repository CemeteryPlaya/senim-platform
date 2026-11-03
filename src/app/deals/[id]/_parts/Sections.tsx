import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";
import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { Alert, DateText, StatusBadge } from "@/ui";
import { ActionButton } from "../../_parts/ActionButton";
import { cancelDealAction } from "../actions";
import { DisputePositionForm, OpenDisputeForm } from "./DealForms";
import { disputeFacts, gpsNote, needsPosition } from "./deal-view";
import { NEXT_HEADING_ID } from "./next-step";
import { ProgressForm } from "./WorkForms";

const t = ru.deal;

export function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-4 border-t border-line pt-6">
      <h2 id={`${id}-title`} className="text-xl font-bold text-ink">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Второстепенное действие под раскрывающимся блоком: «Открыть спор», «Добавить отчёт», «История событий». */
export function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group">
      <summary className="flex min-h-control-sm cursor-pointer list-none items-center gap-2 rounded-control text-lg font-semibold text-ink [&::-webkit-details-marker]:hidden">
        {summary}
        <ChevronDown aria-hidden className="size-5 shrink-0 transition-transform duration-150 group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="pt-4">{children}</div>
    </details>
  );
}

function Photos({ photos, alt }: { photos: readonly { id: string; src: string }[]; alt: (n: number) => string }) {
  if (photos.length === 0) return null;
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,9rem),1fr))] gap-2">
      {photos.map((p, i) => (
        <li key={p.id} className="min-w-0">
          <a href={p.src} target="_blank" rel="noreferrer" className="block rounded-card">
            {/* Превью фото сдачи и отчётов: адрес из хранилища, оптимизатор не нужен. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.src} alt={alt(i + 1)} className="aspect-square w-full rounded-card bg-sunken object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** Сдача работы: фото результата и мягкая проверка расстояния до адреса (попадает в акт). */
export function ReadySection({ deal }: { deal: DealView }) {
  const r = deal.ready;
  if (!r) return null;
  const gps = gpsNote(r);
  return (
    <Section id="ready" title={t.sections.ready}>
      <p className="text-base text-muted">
        {t.ready.submittedAt} <DateText value={r.at} format="dateTime" />
      </p>
      <Photos photos={r.photos} alt={t.ready.photoAlt} />
      {/* Вне радиуса — role="status": после сдачи диктор услышит, что расстояние попадёт в акт. */}
      {gps.tone === "warning" ? (
        <Alert tone="warning" live="polite">
          {gps.text}
        </Alert>
      ) : (
        <p className="text-base text-ink-soft">{gps.text}</p>
      )}
    </Section>
  );
}

/** «Ход работ»: необязательные фото-отчёты мастера лентой; мастеру, пока идут работы, — «Добавить отчёт». */
export function ProgressSection({ deal }: { deal: DealView }) {
  const reports = deal.progressReports;
  if (reports.length === 0 && !deal.can.addProgress) return null;
  return (
    <Section id="progress" title={t.sections.progress}>
      {reports.length > 0 && (
        <ol className="flex flex-col divide-y divide-line">
          {[...reports].reverse().map((r) => {
            const title = r.title || t.progress.untitled;
            return (
              <li key={r.id} className="flex flex-col gap-2 py-4 first:pt-0">
                <h3 className="text-lg font-bold text-ink">{title}</h3>
                <p className="text-base text-muted">
                  <DateText value={r.createdAt} format="dateTime" />
                </p>
                <p className="text-base whitespace-pre-line text-ink-soft">{r.text}</p>
                <Photos photos={r.photos} alt={(n) => t.progress.photoAlt(title, n)} />
              </li>
            );
          })}
        </ol>
      )}
      {deal.can.addProgress && (
        <Disclosure summary={t.actions.addProgress}>
          <ProgressForm dealId={deal.id} />
        </Disclosure>
      )}
    </Section>
  );
}

/** Спор: открыт — позиции сторон и форма своей позиции; решён — итог. Нет спора — «Открыть спор» свёрнуто. */
export function DisputeSection({ deal }: { deal: DealView }) {
  const d = deal.dispute;
  if (!d) {
    return deal.can.openDispute ? (
      <div className="border-t border-line pt-6">
        <Disclosure summary={t.actions.openDispute}>
          <OpenDisputeForm dealId={deal.id} />
        </Disclosure>
      </div>
    ) : null;
  }
  const open = d.status === "OPEN";
  return (
    <Section id="dispute" title={t.sections.dispute}>
      <StatusBadge tone={open ? "warning" : "neutral"} className="self-start">
        {open ? t.dispute.open : t.dispute.resolved}
      </StatusBadge>
      <dl className="flex flex-col divide-y divide-line">
        {disputeFacts(d).map((f) => (
          <div key={f.label} className="flex flex-col gap-1 py-2.5 first:pt-0">
            <dt className="text-base text-muted">{f.label}</dt>
            <dd className="text-base whitespace-pre-line text-ink">{f.value}</dd>
          </div>
        ))}
      </dl>
      {needsPosition(deal.viewer, d) && <DisputePositionForm disputeId={d.id} />}
    </Section>
  );
}

/** Отмена: до оплаты — оферта не исполняется; после оплаты (покупатель) — «Деньги вернутся на вашу карту». */
export function CancelDeal({ deal }: { deal: DealView }) {
  if (!deal.can.cancel) return null;
  const paid = deal.moneyBlock.kind !== "awaiting";
  return (
    <ActionButton
      action={cancelDealAction}
      input={{ dealId: deal.id }}
      variant="ghost"
      focusAfter={NEXT_HEADING_ID}
      confirm={{ title: t.cancel.title, text: paid ? t.cancel.afterPayment : t.cancel.beforePayment, yes: t.actions.confirmCancel, no: ru.common.actions.dontCancel, tone: "danger" }}
    >
      {t.actions.cancel}
    </ActionButton>
  );
}

/** Общая «История событий» (журнал аудита сделки) — отдельно от истории денег. */
export function EventsSection({ deal }: { deal: DealView }) {
  const h = t.history;
  return (
    <div className="border-t border-line pt-6">
      <Disclosure summary={t.sections.events}>
        {deal.history.length === 0 ? (
          <p className="text-base text-muted">{h.empty}</p>
        ) : (
          <ol className="flex flex-col divide-y divide-line">
            {deal.history.map((e) => (
              <li key={e.id} className="flex flex-col gap-1 py-3 first:pt-0">
                <span className="text-base text-ink">{h.action[e.action] ?? e.action}</span>
                <span className="text-base text-muted">
                  {h.actor[e.actorRole as keyof typeof h.actor] ?? e.actorRole}, <DateText value={e.createdAt} format="dateTime" />
                </span>
              </li>
            ))}
          </ol>
        )}
      </Disclosure>
    </div>
  );
}
