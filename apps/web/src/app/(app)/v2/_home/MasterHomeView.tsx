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
import { HowToTakeOrder } from "../executor/_parts/HowToTakeOrder";
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
  /** «Как взять заказ» — пока мастер не отправил ни одного предложения. */
  showHowTo: boolean;
  /** До двух идущих сделок: сделка, «что дальше» по ней и отметка «нет согласия для банка». */
  deals: { item: DealListItem; next: NextStep | null; consentMissing: boolean }[];
  /** Сколько идущих сделок осталось за пределами блока. */
  moreDeals: number;
  /** До трёх новых заявок. */
  fresh: IncomingListItem[];
  /** Числа из модулей: сколько всего новых заявок (для ссылки «Все заявки») и получено за месяц (журнал денег). */
  stats: { fresh: number; earnedTiyn: bigint };
  /** Обложка карточки-героя — последнее фото отчёта сделки из «Сейчас»; `null` — без обложки. */
  cover?: DealCover | null;
};

/**
 * Содержимое карточки «Сейчас / Дальше» по выбору `masterHome`. `inHero` — карточка-герой сделки: её название уже стоит
 * заголовком героя, второй раз в теле его не пишем (у обычной карточки «Сейчас» название нужно).
 */
function nowText(view: View, inHero: boolean): { title: string; body?: string; next?: string } {
  const n = t.now;
  const { kind, deal, counter, freshCount } = view.now;
  const dealTitle = deal?.title ?? "";
  const about = (s: { lead: string; body: (deal: string) => string }) => (inHero ? s.lead : s.body(dealTitle));
  switch (kind) {
    case "sign-offer":
      return { title: n.signOffer.title, body: about(n.signOffer), next: n.signOffer.next };
    case "bank-consent":
      return { title: n.bankConsent.title, body: about(n.bankConsent), next: n.bankConsent.next };
    case "start":
      return { title: n.start.title, body: about(n.start), next: n.start.next };
    case "sign-act":
      return { title: n.signAct.title, body: about(n.signAct), next: n.signAct.next };
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
      return { title: n.inWork.title, body: about(n.inWork) };
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
 * Сводка — одно число «Получено за месяц» из журнала денег (на экране ничего не считается). Счётчики заявок и сделок не
 * показываем: сами заявки и сделки лежат ниже на этом же экране. Пока за месяц ничего не получено — сводки нет
 * (пустое не показываем).
 */
function Summary({ stats }: { stats: MasterHomeData["stats"] }) {
  if (stats.earnedTiyn === 0n) return null;
  return (
    <StatRow label={t.stats.label}>
      <Stat label={t.stats.earned} value={<Money tiyn={stats.earnedTiyn} large tone="ink" />} compact />
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

/**
 * Новые заявки (до трёх). Метки «Новая» в строках нет: раздел так и называется. «Все заявки» — в строке заголовка и только
 * когда новых больше, чем показано («Заявки» есть и в меню).
 */
function FreshRequests({ fresh, total }: { fresh: IncomingListItem[]; total: number }) {
  if (fresh.length === 0) return null;
  const all = total > fresh.length ? <TextLink href={to("/executor/requests")}>{t.requests.all}</TextLink> : undefined;
  return (
    <Section title={t.requests.section} action={all}>
      <IncomingRows cards={fresh.map((r) => incomingCard(r, new Date(), { markFresh: false }))} />
    </Section>
  );
}

/**
 * Показ главной мастера по готовому выбору. Одна колонка на обоих устройствах (компьютер — 760 px по центру, разбор 3.9):
 * «Сейчас» — карточкой-героем, когда речь о сделке (обложка из отчёта, «Вы получите…», ход, кнопка внутри на компьютере),
 * иначе «Сейчас / Дальше» с кнопкой внутри на компьютере; под ним первые шаги и «Как взять заказ» (до первого
 * предложения); затем сводка (получено за месяц), остальные сделки, новые заявки. Телефон — главное действие в доке в конце экрана.
 */
export function MasterHomeView({ data, name, device }: { data: MasterHomeData; name: string | null; device: Device }) {
  const { view } = data;
  // Герой — сделка, о которой «Сейчас» (она первая в блоке сделок); остальные — карточками ниже.
  const heroDeal = view.now.deal ? data.deals.find((d) => d.item.id === view.now.deal?.id) : undefined;
  const rest = heroDeal ? data.deals.filter((d) => d !== heroDeal) : data.deals;
  const text = nowText(view, heroDeal !== undefined);
  const action = view.primary && (
    <ActionDock>
      <ButtonLink href={view.primary.href}>{PRIMARY_LABEL[view.primary.kind]}</ButtonLink>
    </ActionDock>
  );
  // Компьютер: кнопка внутри карточки «Сейчас». Телефон: в доке последним элементом экрана.
  const inCard = device === "desktop" ? action : null;
  const secondary = view.secondary && <TextLink href={view.secondary.href}>{secondaryLabel(view.now.kind)}</TextLink>;
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
      {data.showHowTo && <HowToTakeOrder beforeApproval={false} />}
    </Stack>
  );
  return (
    <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <PageTitle title={t.title(name)} />
      {now}
      <Summary stats={data.stats} />
      <Deals deals={rest} more={data.moreDeals} />
      <FreshRequests fresh={data.fresh} total={data.stats.fresh} />
      {device === "mobile" && action}
    </Stack>
  );
}
