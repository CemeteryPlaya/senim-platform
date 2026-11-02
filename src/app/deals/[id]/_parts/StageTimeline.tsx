import { Check } from "lucide-react";
import type { DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { cn, DateText, formatDate, Money, StatusBadge } from "@/ui";
import { PAYMENT_TONE, STAGE_TONE } from "../../_parts/labels";
import { currentStageIndex, stageDate, stageState } from "./order-view";

const t = ru.deal;
const states = ru.common.ui.timeline;

/** id раздела этапов: на него ведёт «Посмотреть этапы». */
export const STAGES_ID = "stages";

/**
 * Этапы изготовления вертикальной шкалой (макет 10, экран 2): кружок с галочкой у пройденных, выделенный
 * текущий, дата, статус и оплата, отчёт и фотоотчёт исполнителя. Тот же вид, что у Timeline из @/ui, но в
 * пункте — заголовок этапа и фото, поэтому разметка своя.
 */
export function StageTimeline({ deal }: { deal: DealView }) {
  const current = currentStageIndex(deal.status, deal.stages);
  return (
    <section id={STAGES_ID} aria-labelledby={`${STAGES_ID}-title`} className="flex scroll-mt-6 flex-col gap-4">
      <h2 id={`${STAGES_ID}-title`} className="text-xl font-extrabold text-ink">
        {t.sections.stages}
      </h2>
      {deal.viewer === "CLIENT" && <p className="text-base text-muted">{t.view.stagesNoteClient}</p>}
      <ol className="flex flex-col rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
        {deal.stages.map((s, i) => {
          const state = stageState(s, i, current);
          const date = stageDate(s);
          const last = i === deal.stages.length - 1;
          return (
            <li key={s.id} aria-current={state === "current" ? "step" : undefined} className="relative flex gap-3 pb-6 last:pb-0">
              {!last && (
                <span aria-hidden className={cn("absolute top-8 bottom-0 left-[0.9375rem] border-l-2", state === "done" ? "border-primary" : "border-line")} />
              )}
              <span
                aria-hidden
                className={cn(
                  "relative z-10 inline-flex size-8 shrink-0 items-center justify-center rounded-full",
                  state === "done" && "bg-primary text-on-primary",
                  state === "current" && "border-[0.4375rem] border-primary bg-surface ring-4 ring-accent-soft",
                  state === "todo" && "border-2 border-line-strong bg-surface",
                )}
              >
                {state === "done" && <Check className="size-4" strokeWidth={3} />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-3 pt-0.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className={cn("text-lg font-bold", state === "todo" ? "text-ink-soft" : "text-ink")}>
                    {`${t.stage.order(s.order)}. ${s.title}`}
                    <span className="sr-only">: {states[state]}</span>
                  </h3>
                  {date && <span className="text-base text-muted">{t.view.stageDate[date.kind](formatDate(date.at))}</span>}
                </div>
                {s.description && <p className="text-base text-ink-soft">{s.description}</p>}
                <div className="flex flex-wrap gap-2">
                  <StatusBadge tone={STAGE_TONE[s.status]}>{t.stageStatus[s.status]}</StatusBadge>
                  {s.payment && <StatusBadge tone={PAYMENT_TONE[s.payment.status]}>{t.paymentStatus[s.payment.status]}</StatusBadge>}
                  {s.acceptedAutomatically && <StatusBadge tone="info">{t.stage.acceptedAuto}</StatusBadge>}
                </div>
                <p className="text-base text-ink">
                  {s.amount > 0 ? (
                    <>
                      <Money amount={s.amount} /> <span className="text-muted">— {t.paymentDue[s.paymentDue].toLowerCase()}</span>
                    </>
                  ) : (
                    <span className="text-muted">{t.stage.noAmount}</span>
                  )}
                </p>
                {s.status === "REWORK" && s.reworkNote && (
                  <div className="rounded-control bg-warning-soft p-4">
                    <p className="text-base font-semibold text-ink">{t.stage.reworkNote}</p>
                    <p className="text-base text-ink">{s.reworkNote}</p>
                  </div>
                )}
                {s.report && (
                  <div>
                    <p className="text-base font-semibold text-ink">{t.stage.report}</p>
                    <p className="text-base whitespace-pre-line text-ink">{s.report}</p>
                  </div>
                )}
                {s.photos.length > 0 && (
                  <ul className="grid grid-cols-[repeat(3,minmax(0,1fr))] gap-2" aria-label={t.stage.photos}>
                    {s.photos.map((photo, n) => (
                      <li key={photo.id}>
                        <a href={photo.src} target="_blank" rel="noreferrer" className="block rounded-control">
                          {/* eslint-disable-next-line @next/next/no-img-element -- подписанные ссылки хранилища, не статические ассеты */}
                          <img src={photo.src} alt={t.stage.photoAlt(s.title, n + 1)} loading="lazy" className="aspect-square w-full rounded-control bg-sunken object-cover" />
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
                {s.submittedAt && date?.kind !== "submitted" && (
                  <p className="text-base text-muted">
                    {t.stage.submittedAt}: <DateText value={s.submittedAt} format="dateTime" />
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
