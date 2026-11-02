import { MapPin, MessageCircle, UserRound } from "lucide-react";
import { daysLeft, type DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { ButtonLink, DateText, formatDays, formatMonths, Money, PhotoCard, StatusBadge, Stepper } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { currentStageIndex, heroImage } from "./order-view";
import { DEAL_TONE } from "../../_parts/labels";

const t = ru.deal;
const v = t.view;

/**
 * Верх экрана «Мой заказ» (макет 10, экран 1), минималистично: фото и название со статусом, исполнитель, ключевые
 * данные, шкала этапов (она же говорит, какой этап сейчас), «Осталось N дней», переход к чату. Главное действие —
 * в «Что дальше» ниже.
 */
export function OrderSummary({ deal, now }: { deal: DealView; now: Date }) {
  const current = currentStageIndex(deal.status, deal.stages);
  const image = heroImage(deal.stages, deal.subject.roomPhotos, illustrationFor(deal.title));
  const left = current !== null && deal.plannedReadyAt ? daysLeft(deal.plannedReadyAt, now) : null;
  const stage = current !== null ? deal.stages[current] : undefined;
  const isParty = deal.viewer === "CLIENT" || deal.viewer === "EXECUTOR";

  return (
    <div className="flex flex-col gap-4">
      <PhotoCard
        image={image ? { src: image } : null}
        title={deal.title}
        titleAs="h2"
        badge={<StatusBadge tone={DEAL_TONE[deal.status]}>{t.status[deal.status]}</StatusBadge>}
        meta={[
          { icon: <UserRound />, text: deal.executorLabel },
          ...(deal.executorAddress ? [{ icon: <MapPin />, text: deal.executorAddress }] : []),
        ]}
      />

      {/* Пока этапы не начались, шкалы нет — статус поясняется словами. */}
      {!stage && <p className="text-base text-ink-soft">{v.statusText[deal.status]}</p>}

      <section aria-label={v.summary} className="flex flex-col gap-5 border-t border-line pt-5">
        {/* Строки «подпись — значение» с тонкими разделителями; длинное значение переносится под подпись. */}
        <dl className="flex flex-col divide-y divide-line">
          {[
            { label: t.total, value: <Money amount={deal.totalAmount} className="font-bold" /> },
            ...(deal.plannedReadyAt ? [{ label: v.plannedReady, value: <DateText value={deal.plannedReadyAt} format="date" /> }] : []),
            { label: v.duration, value: formatDays(deal.durationDays) },
            { label: v.warranty, value: formatMonths(deal.warrantyMonths) },
            ...(deal.signedAt ? [{ label: v.signedAt, value: <DateText value={deal.signedAt} format="date" /> }] : []),
            { label: t.paymentLabel, value: deal.paymentMode === "MANUAL" ? t.paymentModeManual : ru.payments.mode[deal.paymentMode] },
          ].map((row) => (
            <div key={row.label} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-base first:pt-0">
              <dt className="text-muted">{row.label}</dt>
              <dd className="text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>

        {current !== null && <Stepper steps={deal.stages.map((s) => s.title)} current={current} label={v.stagesScale} />}

        {left !== null && (
          <p className="text-lg font-bold text-ink">{v.daysLeft(formatDays(left))}</p>
        )}

        {isParty && (
          <ButtonLink href="#chat" variant="secondary" icon={<MessageCircle />} className="self-start">
            {v.writeTo[deal.viewer as "CLIENT" | "EXECUTOR"]}
          </ButtonLink>
        )}
      </section>
    </div>
  );
}
