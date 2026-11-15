import Link from "next/link";
import { Card, Money, Progress, StatusChip, Steps } from "@/kit";
import type { DealListItem } from "@/modules/deal-core";
import { to } from "../../_shell/paths";
import type { DealSide } from "../../_shell/side";
import { dealMoneyLine, dealProgress, progressCaption, stoppedLabel, type DealChip } from "./deal-summary";

/**
 * Компактная карточка сделки на главных экранах: вся — ссылка (растянутая на карточку). Название и сумма справа (22 px /
 * 600 — как в списке «Сделки»), под ними плашка статуса и подпись денег из журнала, одна строка хода «Шаг N из M: …» с
 * полосой. Полный ход — на экране сделки. Слова — по стороне (`side`): покупатель и мастер видят свои подписи шагов и денег
 * (`deal-summary.ts`). Сделку из «Сейчас» главная показывает героем (`DealHero`), эта карточка — для остальных.
 */
export function DealSummaryCard({ deal, side, chip, progressLabel }: { deal: DealListItem; side: DealSide; chip: DealChip; progressLabel: string }) {
  const money = dealMoneyLine(deal.money, deal.estimate, side);
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  return (
    <Card
      as="article"
      interactive
      className="pressable relative flex flex-col gap-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
    >
      {/* flex-wrap: при крупном шрифте сумма и плашка уходят строкой ниже, а не сжимают название в полоску. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 text-headline text-ink wrap-break-word">
          <Link href={to(`/deals/${encodeURIComponent(deal.id)}`)} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {deal.title}
          </Link>
        </h3>
        {money.amountTiyn !== null && (
          <p className="text-title-2 tabular-nums text-ink">
            <Money tiyn={money.amountTiyn} />
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
        <span className="text-sub text-muted">{money.label}</span>
      </div>
      {progress.kind === "steps" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sub text-muted">{progressCaption(progress, side)}</p>
          <Progress value={progress.done} max={progress.total} label={progressLabel} />
        </div>
      ) : (
        <Steps label={progressLabel} items={[]} stopped={{ label: stoppedLabel(progress.reason, side) }} />
      )}
    </Card>
  );
}
