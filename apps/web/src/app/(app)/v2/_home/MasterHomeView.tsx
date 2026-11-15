import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, FirstSteps, NowNext, PageTitle, Section, Stack, Stat, StatRow, TextLink, formatMoney, Money } from "@/kit";
import type { DealListItem, NextStep } from "@/modules/deal-core";
import type { IncomingListItem } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { DealHero } from "../_parts/DealHero";
import { DealSummaryCard } from "../_parts/DealSummaryCard";
import type { DealCover } from "../_parts/deal-cover";
import { dealChip } from "../_parts/deal-summary";
import { IncomingRows } from "../executor/_parts/IncomingRows";
import { incomingCard } from "../executor/_parts/incoming-view";
import { type MasterFirstSteps, type MasterHomeView as View, type MasterPrimary } from "./master-home";

const t = ru.app.masterRequests.home;
const steps = ru.app.masterProfile.steps;

/** Всё, что главная показывает кроме приветствия: готовый выбор «Сейчас» и данные блоков (читает `MasterHome`). */
export type MasterHomeData = {
  view: View;
  /** Первые шаги мастера; `null` — не показывать (всё сделано). */
  firstSteps: MasterFirstSteps | null;
  /** До двух идущих сделок: сделка, «что дальше» по ней и отметка «нет согласия для банка». */
  deals: { item: DealListItem; next: NextStep | null; consentMissing: boolean }[];
  /** Сколько идущих сделок осталось за пределами блока. */
  moreDeals: number;
  /** До трёх новых заявок. */
  fresh: IncomingListItem[];
  /** Числа сводки из модулей: новые заявки, сделки в работе, получено за месяц (журнал денег). */
  stats: { fresh: number; inWork: number; earnedTiyn: bigint };
  /** Обложка карточки-героя — последнее фото отчёта сделки из «Сейчас»; `null` — без обложки. */
  cover?: DealCover | null;
};

/** Содержимое карточки «Сейчас / Дальше» по выбору `masterHome`. */
function nowText(view: View): { title: string; body?: string; next?: string } {
  const n = t.now;
  const { kind, deal, counter, freshCount } = view.now;
  const dealTitle = deal?.title ?? "";
  switch (kind) {
    case "sign-offer":
      return { title: n.signOffer.title, body: n.signOffer.body(dealTitle), next: n.signOffer.next };
    case "bank-consent":
      return { title: n.bankConsent.title, body: n.bankConsent.body(dealTitle), next: n.bankConsent.next };
    case "start":
      return { title: n.start.title, body: n.start.body(dealTitle), next: n.start.next };
    case "sign-act":
      return { title: n.signAct.title, body: n.signAct.body(dealTitle), next: n.signAct.next };
    case "counter":
      return { title: n.counter.title, body: counter ? n.counter.body(counter.requestTitle, formatMoney(counter.amountTiyn)) : undefined, next: n.counter.next };
    case "fresh":
      return { title: n.fresh.title(freshCount), body: n.fresh.body, next: n.fresh.next };
    case "kyc":
      return n.kyc;
    case "kyc-rejected":
      return n.kycRejected;
    case "payout":
      return n.payout;
    case "kyc-pending":
      return { title: n.kycPending.title, body: n.kycPending.body };
    case "in-work":
      return { title: n.inWork.title, body: n.inWork.body(dealTitle) };
    case "empty":
      return { title: n.empty.title, body: n.empty.body };
  }
}

const PRIMARY_LABEL: Record<MasterPrimary["kind"], string> = {
  signOffer: t.now.signOffer.action,
  bankConsent: t.now.bankConsent.action,
  start: t.now.start.action,
  signAct: t.now.signAct.action,
  counter: t.now.counter.action,
  fresh: t.now.fresh.action,
  kyc: t.now.kyc.action,
  kycRejected: t.now.kycRejected.action,
  payout: t.now.payout.action,
};

/** Подпись ссылки под «Сейчас», когда главного действия нет. */
function secondaryLabel(kind: View["now"]["kind"]): string {
  if (kind === "in-work") return t.now.inWork.link;
  if (kind === "kyc-pending") return t.now.kycPending.link;
  return t.now.empty.link;
}

/**
 * Сводка числами: ничего не считается на экране — значения пришли из модулей. Телефон — три числа в одну строку (`inline`),
 * сумма компактная с маленьким «₸».
 */
function Summary({ stats, device }: { stats: MasterHomeData["stats"]; device: Device }) {
  return (
    <StatRow label={t.stats.label} inline={device === "mobile"}>
      <Stat label={t.stats.fresh} value={stats.fresh} />
      <Stat label={t.stats.inWork} value={stats.inWork} />
      <Stat label={t.stats.earned} value={<Money tiyn={stats.earnedTiyn} large />} compact />
    </StatRow>
  );
}

/** Остальные идущие сделки (сделка из «Сейчас» — в герое выше и здесь не повторяется). */
function Deals({ deals, more }: { deals: MasterHomeData["deals"]; more: number }) {
  if (deals.length === 0) return more > 0 ? <TextLink href={to("/deals")}>{t.deals.all}</TextLink> : null;
  return (
    <Section title={t.deals.section}>
      <Stack>
        {deals.map(({ item, next, consentMissing }) => (
          <DealSummaryCard
            key={item.id}
            deal={item}
            side="EXECUTOR"
            chip={dealChip({ ...item, side: "EXECUTOR", next, consentMissing })}
            progressLabel={t.deals.progressLabel}
          />
        ))}
      </Stack>
      {more > 0 && <TextLink href={to("/deals")}>{t.deals.all}</TextLink>}
    </Section>
  );
}

function FreshRequests({ fresh }: { fresh: IncomingListItem[] }) {
  if (fresh.length === 0) return null;
  return (
    <Section title={t.requests.section}>
      <IncomingRows cards={fresh.map((r) => incomingCard(r))} />
      <TextLink href={to("/executor/requests")}>{t.requests.all}</TextLink>
    </Section>
  );
}

/**
 * Показ главной мастера по готовому выбору. Одна колонка на обоих устройствах (компьютер — 760 px по центру, разбор 3.9):
 * «Сейчас» — карточкой-героем, когда речь о сделке (обложка из отчёта, «Вы получите…», ход, кнопка внутри на компьютере),
 * иначе «Сейчас / Дальше» с кнопкой внутри на компьютере; затем сводка, остальные сделки, новые заявки. Телефон — главное
 * действие в доке в конце экрана.
 */
export function MasterHomeView({ data, name, device }: { data: MasterHomeData; name: string | null; device: Device }) {
  const { view } = data;
  const text = nowText(view);
  const action = view.primary && (
    <ActionDock>
      <ButtonLink href={view.primary.href}>{PRIMARY_LABEL[view.primary.kind]}</ButtonLink>
    </ActionDock>
  );
  // Компьютер: кнопка внутри карточки «Сейчас». Телефон: в доке последним элементом экрана.
  const inCard = device === "desktop" ? action : null;
  const secondary = view.secondary && <TextLink href={view.secondary.href}>{secondaryLabel(view.now.kind)}</TextLink>;
  // Герой — сделка, о которой «Сейчас» (она первая в блоке сделок); остальные — карточками ниже.
  const heroDeal = view.now.deal ? data.deals.find((d) => d.item.id === view.now.deal?.id) : undefined;
  const rest = heroDeal ? data.deals.filter((d) => d !== heroDeal) : data.deals;
  const now = (
    <Stack>
      {heroDeal ? (
        <DealHero deal={heroDeal.item} side="EXECUTOR" cover={data.cover ?? null} now={text} action={inCard} link={secondary} progressLabel={t.deals.progressLabel} />
      ) : (
        <>
          <NowNext now={{ title: text.title, ...(text.body ? { body: text.body } : {}) }} {...(text.next ? { next: text.next } : {})} action={inCard} />
          {secondary}
        </>
      )}
      {data.firstSteps && (
        <FirstSteps
          steps={[
            { label: steps.profile, done: true },
            { label: steps.documents, ...data.firstSteps.documents },
            { label: steps.payout, ...data.firstSteps.payout },
            { label: steps.offer, ...data.firstSteps.offer },
          ]}
        />
      )}
    </Stack>
  );
  return (
    <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <PageTitle title={t.title(name)} />
      {now}
      <Summary stats={data.stats} device={device} />
      <Deals deals={rest} more={data.moreDeals} />
      <FreshRequests fresh={data.fresh} />
      {device === "mobile" && action}
    </Stack>
  );
}
