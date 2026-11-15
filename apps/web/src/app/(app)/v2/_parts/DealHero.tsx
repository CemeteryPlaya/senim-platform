import Link from "next/link";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { Card, Money, Progress, Steps } from "@/kit";
import type { DealListItem } from "@/modules/deal-core";
import { to } from "../../_shell/paths";
import type { DealSide } from "../../_shell/side";
import type { DealCover } from "./deal-cover";
import { DealCoverPhoto } from "./DealCoverPhoto";
import { dealMoneyLine, dealProgress, progressCaption, stoppedLabel } from "./deal-summary";

export type DealHeroProps = {
  deal: DealListItem;
  side: DealSide;
  /** Последнее фото отчёта хода работ (`dealCover`); нет — карточка без обложки. */
  cover: DealCover | null;
  /**
   * «Сейчас / Дальше» главной: тексты уже выбраны таблицей стороны. Нет — вторая карточка (другая сделка в работе с
   * обложкой): без «Сейчас» и без главного действия, только ссылка на сделку (`link`).
   */
  now?: { title: string; body?: string; next?: string };
  /** Главное действие — только компьютер (кнопка внутри карточки); на телефоне оно в доке экрана. */
  action?: ReactNode;
  /** Второстепенная ссылка под «Сейчас» («Открыть сделку»). */
  link?: ReactNode;
  progressLabel: string;
};

/** Ширина обложки: на компьютере — половина колонки главной (760 px), на телефоне — экран. */
const COVER_SIZES = "(min-width: 64rem) 380px, 100vw";

/**
 * Карточка-герой текущей сделки на главной (разбор 3.6, раздел 4 п. 6): одна карточка вместо «Сейчас» и «Моей сделки».
 * Обложка — последнее фото отчёта (телефон — 16:9 сверху, компьютер — слева на высоту карточки), на ней — шаг сделки
 * капсулой на стекле поверх затемнения. Дальше — название сделки ссылкой, сумма крупно (`display`, знак «₸» меньше) и
 * подпись денег стороны из журнала, полоса хода, «Сейчас» и «Дальше», кнопка (компьютер). Статус называет «Сейчас» —
 * отдельной плашки в герое нет: заголовок, плашка и кнопка не повторяют одно и то же.
 */
export function DealHero({ deal, side, cover, now, action, link, progressLabel }: DealHeroProps) {
  const money = dealMoneyLine(deal.money, deal.estimate, side);
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  const caption = progressCaption(progress, side);
  const n = ru.app.kit.nowNext;
  const coverNode = cover && <DealCoverPhoto cover={cover} caption={caption} sizes={COVER_SIZES} />;
  return (
    <Card as="section" variant="hero" cover={coverNode} coverAside>
      <div className="flex flex-col gap-1">
        <p className="text-title-2 wrap-break-word text-ink">
          <Link href={to(`/deals/${encodeURIComponent(deal.id)}`)} className="text-ink no-underline hover:underline">
            {deal.title}
          </Link>
        </p>
        {money.amountTiyn !== null ? (
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-display-amount tabular-nums text-ink">
              <Money tiyn={money.amountTiyn} large />
            </span>{" "}
            <span className="text-sub text-muted">{money.label}</span>
          </p>
        ) : (
          <p className="text-body text-ink">{money.label}</p>
        )}
      </div>
      {progress.kind === "steps" ? (
        <div className="flex flex-col gap-2">
          {/* С обложкой шаг написан на фото — под ней только полоса. */}
          {!cover && caption && <p className="text-sub text-muted">{caption}</p>}
          <Progress value={progress.done} max={progress.total} label={progressLabel} segmented />
        </div>
      ) : (
        <Steps label={progressLabel} items={[]} stopped={{ label: stoppedLabel(progress.reason, side) }} />
      )}
      {now && (
        <div className="flex flex-col gap-1 border-t border-line pt-4">
          <p className="text-small text-muted">{n.now}</p>
          <h2 className="text-headline text-ink">{now.title}</h2>
          {now.body && <p className="text-sub text-muted">{now.body}</p>}
          {now.next && (
            <>
              <p className="mt-2 text-small text-muted">{n.next}</p>
              <p className="text-body text-ink">{now.next}</p>
            </>
          )}
        </div>
      )}
      {action}
      {link}
    </Card>
  );
}
