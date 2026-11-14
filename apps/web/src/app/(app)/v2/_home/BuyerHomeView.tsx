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
  NowNext,
  PageTitle,
  Section,
  Split,
  Stack,
  StatusChip,
  TextLink,
} from "@/kit";
import type { DealListItem } from "@/modules/deal-core";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { HELP_ANCHORS } from "../help/anchors";
import { helpItem } from "../help/questions";
import { DealSummaryCard } from "../_parts/DealSummaryCard";
import { dealChip } from "../_parts/deal-summary";
import { requestState } from "../_parts/request-state";
import { type BuyerHomeView as View, type HomeDealInput, type HomeRequestInput, type PrimaryAction } from "./buyer-home";

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
    case "deal-unknown":
      return { title: n.unknown.title, body: n.unknown.body };
    case "deal-waiting": {
      const title = now.waitAction ? n.waiting[now.waitAction] : n.waiting.generic;
      return { title, body: n.waiting.body };
    }
  }
}

/** Подпись второстепенной ссылки под «Сейчас»: заявка или сделка. */
function secondaryLabel(kind: View["now"]["kind"]): string {
  if (kind === "request-chosen") return t.now.requestChosen.link;
  if (kind === "deal-unknown") return t.now.unknown.link;
  return t.now.requestWaiting.link;
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
            {/* Первая группа: что сейчас, действие и путь целиком. Главное действие компьютера — прямо под «Сейчас» (через 12 px). */}
            <Stack>
              <NowNext now={{ title: text.title, ...(text.body ? { body: text.body } : {}) }} {...(text.next ? { next: text.next } : {})} />
              {/* Компьютер: действие сразу под «Сейчас». Телефон: в доке в конце экрана (ниже). */}
              {device === "desktop" && action}
              {view.secondary && (
                <TextLink href={view.secondary.href}>{secondaryLabel(view.now.kind)}</TextLink>
              )}
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
            </Stack>
            {deal && <DealCard deal={deal} listed={view.deal} more={view.moreDeals} />}
            {view.requests.length > 0 && <RequestsSection requests={view.requests} />}
          </Stack>
        }
        aside={
          <HelpBlock
            items={[helpItem(HELP_ANCHORS.how), helpItem(HELP_ANCHORS.price)]}
            supportEmail={brand.support.email}
          />
        }
      />
      {device === "mobile" && action}
    </Stack>
  );
}

/** Карточка сделки на главной: общая с мастером (`DealSummaryCard`), слова покупателя. */
function DealCard({ deal, listed, more }: { deal: DealListItem; listed: HomeDealInput | null; more: number }) {
  const chip = dealChip({ ...deal, side: "CLIENT", next: listed?.next ?? null, payWaitsMaster: listed?.payWaitsMaster ?? false });
  return (
    <Section title={t.deal.section}>
      <DealSummaryCard deal={deal} side="CLIENT" chip={chip} progressLabel={t.deal.progressLabel} />
      {more > 0 && <TextLink href={to("/deals")}>{t.deal.allDeals}</TextLink>}
    </Section>
  );
}

/**
 * До двух живых заявок: название и плашка состояния — та же `requestState`, что в «Моих заявках» и в карточке заявки
 * (число действующих предложений — внутри неё); остальные — «Все заявки».
 */
function RequestsSection({ requests }: { requests: HomeRequestInput[] }) {
  return (
    <Section title={t.requests.section}>
      <Card padded={false}>
        <List>
          {requests.map((r) => {
            const state = requestState(r);
            return (
              <ListRow
                key={r.id}
                label={
                  <span className="flex flex-col items-start gap-1">
                    <span className="text-body wrap-break-word text-ink">{ru.requests.requestTitle(r.number, r.title)}</span>
                    <StatusChip tone={state.tone}>{state.text}</StatusChip>
                  </span>
                }
                href={r.status === "DRAFT" ? to(`/requests/new?draft=${encodeURIComponent(r.id)}`) : to(`/requests/${encodeURIComponent(r.id)}`)}
              />
            );
          })}
        </List>
      </Card>
      <TextLink href={to("/requests")}>{t.requests.all}</TextLink>
    </Section>
  );
}
