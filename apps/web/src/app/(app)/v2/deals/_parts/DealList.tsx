import Link from "next/link";
import { ru } from "@/i18n/ru";
import { Card, Chips, EmptyState, Progress, Stack, StatusChip, Steps, TextLink } from "@/kit";
import { to } from "../../../_shell/paths";
import type { DealSide } from "../../../_shell/side";
import { DealMoney } from "../../_parts/DealMoney";
import type { DealCardView, DealListView } from "./list-view";

const t = ru.app.deal.list;
const tm = ru.app.masterDeal.list;
/** Подпись полосы хода — «Ход сделки», одинаковая у сторон. */
const progressLabel = ru.app.deal.card.steps.section;

/**
 * Карточка сделки — вся ссылка (растянутая на карточку, как «Моя сделка» на главной): название и справа деньги одним блоком
 * (сумма 22 px / 600 — главное в строке, разбор 2.2, и подпись под ней), ниже плашка статуса своей строкой, ход «Шаг N из
 * M: …» с полосой (или строка остановки). Что нужно от человека — говорит плашка. На компьютере — отклик наведения (`interactive`).
 */
function DealCard({ card }: { card: DealCardView }) {
  return (
    <Card
      as="li"
      interactive
      className="pressable relative flex flex-col gap-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
    >
      {/* flex-wrap: при крупном шрифте блок денег уходит строкой ниже целиком, а не сжимает название в полоску. */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <h2 className="min-w-0 text-headline text-ink wrap-break-word">
          <Link href={card.href} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
            {card.title}
          </Link>
        </h2>
        <DealMoney money={card.money} />
      </div>
      <div className="flex">
        <StatusChip tone={card.chip.tone}>{card.chip.text}</StatusChip>
      </div>
      {card.progress === null ? null : card.progress.kind === "steps" ? (
        <div className="flex flex-col gap-2">
          <p className="text-sub text-muted">{card.progress.caption}</p>
          <Progress value={card.progress.done} max={card.progress.total} label={progressLabel} />
        </div>
      ) : (
        <Steps label={progressLabel} items={[]} stopped={{ label: card.progress.label }} />
      )}
    </Card>
  );
}

/** Пустой экран стороны: покупателю — «Заказать мебель», мастеру — «Открыть заявки». */
const EMPTY = {
  CLIENT: { title: t.emptyTitle, body: t.emptyBody, action: { href: to("/requests/new"), label: t.order }, otherRole: t.otherRole },
  EXECUTOR: { title: tm.emptyTitle, body: tm.emptyBody, action: { href: to("/executor/requests"), label: tm.toRequests }, otherRole: tm.otherRole },
} as const satisfies Record<DealSide, unknown>;

/**
 * Группы чипами и карточки выбранной группы; пусто совсем — обучающий экран с единственным действием стороны. `otherRole` —
 * адрес переключения на другую роль, если в ней у человека есть сделки.
 */
export function DealList({ view, otherRole, side = "CLIENT" }: { view: DealListView; otherRole: string | null; side?: DealSide }) {
  const e = EMPTY[side];
  const switchLink = otherRole && <TextLink href={otherRole}>{e.otherRole}</TextLink>;
  if (view.empty === "none") {
    return (
      <Stack>
        <EmptyState title={e.title} body={e.body} action={e.action} />
        {switchLink}
      </Stack>
    );
  }
  return (
    <Stack>
      <Chips label={t.groupsLabel} items={view.chips} />
      {view.empty === "group" ? (
        <p className="text-body text-muted">{t.groupEmpty[view.group]}</p>
      ) : (
        <ul className="flex flex-col gap-stack-group">
          {view.cards.map((card) => (
            <DealCard key={card.id} card={card} />
          ))}
        </ul>
      )}
      {switchLink}
    </Stack>
  );
}
