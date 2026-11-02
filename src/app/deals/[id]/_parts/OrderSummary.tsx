import { MapPin, MessageCircle, UserRound } from "lucide-react";
import { daysLeft, type DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { ButtonLink, DateText, Fact, formatDays, formatMonths, Money, PhotoCard, StatusBadge, Stepper } from "@/ui";
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
        <dl className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
          <Fact label={t.total}>
            <Money amount={deal.totalAmount} />
          </Fact>
          {deal.plannedReadyAt && (
            <Fact label={v.plannedReady}>
              <DateText value={deal.plannedReadyAt} format="date" />
            </Fact>
          )}
          <Fact label={v.duration}>{formatDays(deal.durationDays)}</Fact>
          <Fact label={v.warranty}>{formatMonths(deal.warrantyMonths)}</Fact>
          {deal.signedAt && (
            <Fact label={v.signedAt}>
              <DateText value={deal.signedAt} format="date" />
            </Fact>
          )}
          <Fact label={t.paymentLabel}>{deal.paymentMode === "MANUAL" ? t.paymentModeManual : ru.payments.mode[deal.paymentMode]}</Fact>
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
