import { CalendarClock, ListOrdered, MapPin, MessageCircle, UserRound } from "lucide-react";
import { daysLeft, type DealView } from "@/modules/deal-core";
import { ru } from "@/i18n/ru";
import { Alert, ButtonLink, DateText, Fact, formatDays, formatMonths, Money, PhotoCard, Stepper } from "@/ui";
import { illustrationFor } from "@/app/_home/illustration";
import { currentStageIndex, heroImage } from "./order-view";
import { STAGES_ID } from "./StageTimeline";

const t = ru.deal;
const v = t.view;

/**
 * Верх экрана «Мой заказ» (макет 10, экран 1): фото и название, исполнитель, плашка статуса, ключевые данные,
 * шкала этапов, «Осталось N дней», переходы к этапам и чату. Главное действие — в «Что дальше» ниже.
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
        meta={[
          { icon: <UserRound />, text: deal.executorLabel },
          ...(deal.executorAddress ? [{ icon: <MapPin />, text: deal.executorAddress }] : []),
        ]}
      />

      <Alert tone={deal.status === "DISPUTE" ? "danger" : "accent"} title={t.status[deal.status]}>
        {stage ? v.stageNow(stage.order, deal.stages.length, stage.title) : v.statusText[deal.status]}
      </Alert>

      <section aria-label={v.summary} className="flex flex-col gap-5 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
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
          <div className="flex items-center gap-3 rounded-control bg-sunken p-4">
            <CalendarClock aria-hidden className="size-8 shrink-0 text-primary" />
            <p className="flex flex-col">
              <span className="text-lg font-bold text-ink">{v.daysLeft(formatDays(left))}</span>
              <span className="text-base text-muted">{v.daysLeftHint}</span>
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href={`#${STAGES_ID}`} variant="secondary" icon={<ListOrdered />} className="sm:flex-1">
            {v.viewStages}
          </ButtonLink>
          {isParty && (
            <ButtonLink href="#chat" variant="secondary" icon={<MessageCircle />} className="sm:flex-1">
              {v.writeTo[deal.viewer as "CLIENT" | "EXECUTOR"]}
            </ButtonLink>
          )}
        </div>
      </section>
    </div>
  );
}
