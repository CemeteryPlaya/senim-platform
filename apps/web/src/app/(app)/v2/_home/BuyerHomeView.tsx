import Link from "next/link";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  FirstSteps,
  HelpBlock,
  List,
  ListRow,
  Money,
  NowNext,
  PageTitle,
  Progress,
  Section,
  Split,
  Stack,
  StatusChip,
  Steps,
  TextLink,
} from "@/kit";
import { homeDealMoney } from "@/features/deal-money/home-deal-money";
import type { DealListItem } from "@/modules/deal-core";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { dealProgress, dealTone, requestStatusText, type BuyerHomeView as View, type HomeDealInput, type HomeRequestInput, type PrimaryAction } from "./buyer-home";

const t = ru.app.buyer.home;

/** Содержимое карточки «Сейчас / Дальше» по выбору `buyerHome`. */
function nowText(view: View): { title: string; body?: string; next?: string } {
  const n = t.now;
  const { now } = view;
  const requestName = now.request ? ru.requests.requestTitle(now.request.number, now.request.title) : undefined;
  switch (now.kind) {
    case "empty":
      return n.order;
    case "draft":
      return { ...n.draft };
    case "offers":
      return { title: n.offers.title(now.offersCount), ...(requestName ? { body: requestName } : {}), next: n.offers.next };
    case "request-waiting":
      return { title: n.requestWaiting.title, body: requestName ? `${requestName}. ${n.requestWaiting.body}` : n.requestWaiting.body, next: n.requestWaiting.next };
    case "request-chosen":
      return { title: n.requestChosen.title, ...(requestName ? { body: requestName } : {}), next: n.requestChosen.next };
    case "sign-offer":
      return n.signOffer;
    case "pay":
      return n.pay;
    case "accept":
      return n.accept;
    case "review":
      return { title: n.review.title, body: n.review.body };
    case "deal-dispute":
      return n.dispute;
    case "deal-waiting": {
      const title = now.waitAction ? n.waiting[now.waitAction] : n.waiting.generic;
      return { title, body: n.waiting.body };
    }
  }
}

const PRIMARY_LABEL: Record<PrimaryAction["kind"], string> = {
  signOffer: t.now.signOffer.action,
  pay: t.now.pay.action,
  accept: t.now.accept.action,
  review: t.now.review.action,
  offers: t.now.offers.action,
  draft: t.now.draft.action,
  order: t.now.order.action,
};

/** Показ главной покупателя по готовому выбору. Телефон — одна колонка, главное действие в доке; компьютер — `Split`. */
export function BuyerHomeView({ view, name, deal, device }: { view: View; name: string | null; deal: DealListItem | null; device: Device }) {
  const text = nowText(view);
  const action = view.primary && (
    <ActionDock>
      <ButtonLink href={view.primary.href}>{PRIMARY_LABEL[view.primary.kind]}</ButtonLink>
    </ActionDock>
  );
  const first = view.firstSteps;
  return (
    <Stack gap="section">
      <PageTitle title={t.title(name)} />
      <Split
        main={
          <Stack gap="section">
            {/* Первая группа: что сейчас и что делать. Главное действие компьютера — прямо под «Сейчас» (через 12 px). */}
            <Stack>
              {first && (
                <FirstSteps
                  steps={[
                    { label: t.steps.profile, done: true },
                    { label: t.steps.order, ...first.order },
                    { label: t.steps.master, ...first.master },
                    { label: t.steps.pay, ...first.pay },
                  ]}
                />
              )}
              <NowNext now={{ title: text.title, ...(text.body ? { body: text.body } : {}) }} {...(text.next ? { next: text.next } : {})} />
              {/* Компьютер: действие сразу под «Сейчас». Телефон: в доке в конце экрана (ниже). */}
              {device === "desktop" && action}
              {view.secondary && (
                <TextLink href={view.secondary.href}>{view.now.kind === "request-chosen" ? t.now.requestChosen.link : t.now.requestWaiting.link}</TextLink>
              )}
            </Stack>
            {deal && <DealCard deal={deal} listed={view.deal} more={view.moreDeals} />}
            {view.requests.length > 0 && <RequestsSection requests={view.requests} />}
          </Stack>
        }
        aside={
          <HelpBlock
            items={[
              { question: t.help.how, href: to("/about") },
              { question: t.help.price, href: to("/about") },
            ]}
            supportEmail={brand.support.email}
          />
        }
      />
      {device === "mobile" && action}
    </Stack>
  );
}

/**
 * Компактная карточка сделки: вся — ссылка (растянутая на карточку). Название, плашка статуса, одна строка хода
 * «Шаг N из M: …» с полосой и строка денег из журнала. Полный ход — на экране сделки.
 */
function DealCard({ deal, listed, more }: { deal: DealListItem; listed: HomeDealInput | null; more: number }) {
  const money = homeDealMoney(deal.money, deal.estimate);
  const progress = dealProgress(deal.status, deal.hasOpenDispute);
  const tone = dealTone({ status: deal.status, hasOpenDispute: deal.hasOpenDispute, next: listed?.next ?? null });
  const names = t.deal.steps;
  return (
    <Section title={t.deal.section}>
      <Card
        as="article"
        className="pressable relative flex flex-col gap-3 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-focus"
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-card text-ink wrap-break-word">
            <Link href={to(`/deals/${encodeURIComponent(deal.id)}`)} className="text-ink no-underline after:absolute after:inset-0 after:rounded-card focus-visible:outline-none">
              {deal.title}
            </Link>
          </h3>
          <StatusChip tone={tone}>{deal.hasOpenDispute ? ru.deal.disputeOpenBadge : ru.deal.status[deal.status]}</StatusChip>
        </div>
        {progress.kind === "steps" ? (
          <div className="flex flex-col gap-2">
            <p className="text-sub text-muted">
              {progress.done >= progress.total
                ? t.deal.allDone
                : t.deal.caption(progress.done + 1, progress.total, names[progress.done] ?? "")}
            </p>
            <Progress value={progress.done} max={progress.total} label={t.deal.progressLabel} />
          </div>
        ) : (
          <Steps label={t.deal.progressLabel} items={[]} stopped={{ label: t.deal.stopped[progress.reason] }} />
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
      {more > 0 && <TextLink href={to("/deals")}>{t.deal.allDeals}</TextLink>}
    </Section>
  );
}

/** До двух живых заявок: название, статус, число предложений; остальные — «Все заявки». */
function RequestsSection({ requests }: { requests: HomeRequestInput[] }) {
  return (
    <Section title={t.requests.section}>
      <Card padded={false}>
        <List>
          {requests.map((r) => (
            <ListRow
              key={r.id}
              stacked
              label={ru.requests.requestTitle(r.number, r.title)}
              value={requestStatusText(r.status, r.offersCount)}
              href={r.status === "DRAFT" ? to(`/requests/new?draft=${encodeURIComponent(r.id)}`) : to(`/requests/${encodeURIComponent(r.id)}`)}
            />
          ))}
        </List>
      </Card>
      <TextLink href={to("/requests")}>{t.requests.all}</TextLink>
    </Section>
  );
}
