import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, NowNext, PageTitle, Section, Split, Stack, Stat, StatRow, TextLink, formatMoney, Money } from "@/kit";
import type { DealListItem, NextStep } from "@/modules/deal-core";
import type { IncomingListItem } from "@/modules/requests";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { DealSummaryCard } from "../_parts/DealSummaryCard";
import { dealChip } from "../_parts/deal-summary";
import { IncomingRows } from "../executor/_parts/IncomingRows";
import { incomingCard } from "../executor/_parts/incoming-view";
import { type MasterHomeView as View, type MasterPrimary } from "./master-home";

const t = ru.app.masterRequests.home;

/** Всё, что главная показывает кроме приветствия: готовый выбор «Сейчас» и данные блоков (читает `MasterHome`). */
export type MasterHomeData = {
  view: View;
  /** До двух идущих сделок: сделка, «что дальше» по ней и отметка «нет согласия для банка». */
  deals: { item: DealListItem; next: NextStep | null; consentMissing: boolean }[];
  /** Сколько идущих сделок осталось за пределами блока. */
  moreDeals: number;
  /** До трёх новых заявок. */
  fresh: IncomingListItem[];
  /** Числа сводки из модулей: новые заявки, сделки в работе, получено за месяц (журнал денег). */
  stats: { fresh: number; inWork: number; earnedTiyn: bigint };
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

/** Сводка числами: ничего не считается на экране — значения пришли из модулей. */
function Summary({ stats }: { stats: MasterHomeData["stats"] }) {
  return (
    <StatRow label={t.stats.label}>
      <Stat label={t.stats.fresh} value={stats.fresh} />
      <Stat label={t.stats.inWork} value={stats.inWork} />
      <Stat label={t.stats.earned} value={<Money tiyn={stats.earnedTiyn} />} compact />
    </StatRow>
  );
}

function Deals({ data }: { data: MasterHomeData }) {
  if (data.deals.length === 0) return null;
  return (
    <Section title={t.deals.section}>
      <Stack>
        {data.deals.map(({ item, next, consentMissing }) => (
          <DealSummaryCard
            key={item.id}
            deal={item}
            side="EXECUTOR"
            chip={dealChip({ ...item, side: "EXECUTOR", next, consentMissing })}
            progressLabel={t.deals.progressLabel}
          />
        ))}
      </Stack>
      {data.moreDeals > 0 && <TextLink href={to("/deals")}>{t.deals.all}</TextLink>}
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
 * Показ главной мастера по готовому выбору. Телефон — одна колонка: «Сейчас», сводка, сделки, новые заявки, главное
 * действие в доке. Компьютер — `Split`: слева «Сейчас» с действием и сделки, справа сводка и новые заявки.
 */
export function MasterHomeView({ data, name, device }: { data: MasterHomeData; name: string | null; device: Device }) {
  const { view } = data;
  const text = nowText(view);
  const action = view.primary && (
    <ActionDock>
      <ButtonLink href={view.primary.href}>{PRIMARY_LABEL[view.primary.kind]}</ButtonLink>
    </ActionDock>
  );
  const now = (
    <Stack>
      <NowNext now={{ title: text.title, ...(text.body ? { body: text.body } : {}) }} {...(text.next ? { next: text.next } : {})} />
      {/* Компьютер: действие сразу под «Сейчас». Телефон: в доке в конце экрана (ниже). */}
      {device === "desktop" && action}
      {view.secondary && <TextLink href={view.secondary.href}>{secondaryLabel(view.now.kind)}</TextLink>}
    </Stack>
  );
  const title = <PageTitle title={t.title(name)} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              {now}
              <Deals data={data} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Summary stats={data.stats} />
              <FreshRequests fresh={data.fresh} />
            </Stack>
          }
        />
      </Stack>
    );
  }
  return (
    <Stack gap="section">
      {title}
      {now}
      <Summary stats={data.stats} />
      <Deals data={data} />
      <FreshRequests fresh={data.fresh} />
      {action}
    </Stack>
  );
}
