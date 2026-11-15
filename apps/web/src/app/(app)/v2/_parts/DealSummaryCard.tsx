import Link from "next/link";
import { Card, Money, Progress, StatusChip, Steps } from "@/kit";
import type { DealListItem } from "@/modules/deal-core";
import { to } from "../../_shell/paths";
import type { DealSide } from "../../_shell/side";
import { dealMoneyLine, dealProgress, progressCaption, stoppedLabel, type DealChip } from "./deal-summary";

/**
 * Компактная карточка сделки на главных экранах: вся — ссылка (растянутая на карточку). Название, плашка статуса, одна
 * строка хода «Шаг N из M: …» с полосой и строка денег из журнала. Полный ход — на экране сделки. Слова — по стороне
 * (`side`): покупатель и мастер видят свои подписи шагов и денег (`deal-summary.ts`).
 */
export function DealSummaryCard({ deal, side, chip, progressLabel }: { deal: DealListItem; side: DealSide; chip: DealChip; progressLabel: string }) {
  const money = dealMoneyLine(deal.money, deal.estimate, side);
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  return (
    <Card
      as="article"
      className="pressable relative flex flex-col gap-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
    >
      {/* flex-wrap: при крупном шрифте плашка статуса уходит строкой ниже, а не сжимает название в полоску. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h3 className="min-w-0 text-headline text-ink wrap-break-word">
          <Link href={to(`/deals/${encodeURIComponent(deal.id)}`)} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {deal.title}
          </Link>
        </h3>
        <StatusChip tone={chip.tone}>{chip.text}</StatusChip>
      </div>
      {progress.kind === "steps" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sub text-muted">{progressCaption(progress, side)}</p>
          <Progress value={progress.done} max={progress.total} label={progressLabel} />
        </div>
      ) : (
        <Steps label={progressLabel} items={[]} stopped={{ label: stoppedLabel(progress.reason, side) }} />
      )}
      <p className="text-body text-ink">
        {money.amountTiyn !== null && (
          <>
            <Money tiyn={money.amountTiyn} />{" "}
          </>
        )}
        {money.label}
      </p>
    </Card>
  );
}
