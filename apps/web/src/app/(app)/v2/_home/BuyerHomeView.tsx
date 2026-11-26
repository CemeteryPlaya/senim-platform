import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, FirstSteps, HelpBlock, List, ListRow, NowNext, PageTitle, Section, Stack, StatusChip, TextLink } from "@/kit";
import type { DealListItem } from "@/modules/deal-core";
import type { Device } from "@/platform/device";
import { to } from "../../_shell/paths";
import { HELP_ANCHORS } from "../help/anchors";
import { helpItem } from "../help/questions";
import { DealHero } from "../_parts/DealHero";
import type { DealCover } from "../_parts/deal-cover";
import { requestState } from "../_parts/request-state";
import { thumbOf } from "../_parts/Thumb";
import { type BuyerHomeView as View, type HomeRequestInput, type PrimaryAction } from "./buyer-home";

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

/**
 * Показ главной покупателя по готовому выбору. Одна колонка на обоих устройствах (компьютер — 760 px по центру, без
 * пустой правой колонки, разбор 3.9): идёт сделка — карточка-герой (`DealHero`: обложка из отчёта, сумма, ход, «Сейчас» и
 * кнопка внутри на компьютере); у неё нет фото — второй карточкой другая сделка «в работе» с фото (`inWork`, без
 * главного действия); сделки нет — «Сейчас / Дальше» с кнопкой внутри на компьютере. Ниже заявки и «Помощь».
 * Телефон — главное действие в доке в конце экрана.
 */
export function BuyerHomeView({
  view,
  name,
  deal,
  cover = null,
  inWork = null,
  device,
}: {
  view: View;
  name: string | null;
  deal: DealListItem | null;
  cover?: DealCover | null;
  /** Другая сделка «в работе» с фото отчёта — второй карточкой-героем, когда у текущей сделки фото нет. */
  inWork?: { deal: DealListItem; cover: DealCover } | null;
  device: Device;
}) {
  const text = nowText(view);
  const action = view.primary && (
    <ActionDock>
      <ButtonLink href={view.primary.href}>{PRIMARY_LABEL[view.primary.kind]}</ButtonLink>
    </ActionDock>
  );
  // Компьютер: кнопка внутри карточки «Сейчас» (героя). Телефон: в доке последним элементом экрана.
  const inCard = device === "desktop" ? action : null;
  const secondary = view.secondary && <TextLink href={view.secondary.href}>{secondaryLabel(view.now.kind)}</TextLink>;
  const first = view.firstSteps;
  const firstSteps = first && (
    <FirstSteps
      steps={[
        { label: t.steps.profile, done: true },
        { label: t.steps.order, ...first.order },
        { label: t.steps.master, ...first.master },
        { label: t.steps.pay, ...first.pay },
      ]}
    />
  );
  return (
    <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
      <PageTitle title={t.title(name)} />
      {/* Первая группа: что сейчас, действие и путь целиком. */}
      {deal ? (
        <Stack>
          <DealHero deal={deal} side="CLIENT" cover={cover} now={text} action={inCard} link={secondary} progressLabel={t.deal.progressLabel} />
          {inWork && (
            // Вторая карточка — без «Сейчас» и без главного действия: только ссылка на сделку.
            <DealHero
              deal={inWork.deal}
              side="CLIENT"
              cover={inWork.cover}
              link={<TextLink href={to(`/deals/${encodeURIComponent(inWork.deal.id)}`)}>{t.now.unknown.link}</TextLink>}
              progressLabel={t.deal.progressLabel}
            />
          )}
          {firstSteps}
        </Stack>
      ) : (
        <Stack>
          <NowNext now={{ title: text.title, ...(text.body ? { body: text.body } : {}) }} {...(text.next ? { next: text.next } : {})} action={inCard} />
          {secondary}
          {firstSteps}
        </Stack>
      )}
      {view.requests.length > 0 && <RequestsSection requests={view.requests} />}
      <HelpBlock items={[helpItem(HELP_ANCHORS.how), helpItem(HELP_ANCHORS.price)]} supportEmail={brand.support.email} />
      {device === "mobile" && action}
    </Stack>
  );
}

/**
 * До двух живых заявок: миниатюра (первое фото помещения), название и короткая плашка состояния — та же `requestState`,
 * что в «Моих заявках» и в карточке заявки (число предложений — строкой рядом с плашкой); остальные — по ссылке «Все»
 * в строке заголовка. Название без «Заявка №…»: раздел уже называется «Мои заявки».
 */
function RequestsSection({ requests }: { requests: HomeRequestInput[] }) {
  const all = (
    <TextLink href={to("/requests")}>
      <span aria-hidden>{t.requests.allShort}</span>
      <span className="sr-only">{t.requests.all}</span>
    </TextLink>
  );
  return (
    <Section title={t.requests.section} action={all}>
      <Card variant="grouped">
        <List>
          {requests.map((r) => {
            const state = requestState(r);
            return (
              <ListRow
                key={r.id}
                leading={thumbOf(r.cover)}
                label={
                  <span className="flex flex-col items-start gap-1 py-1">
                    <span className="text-headline wrap-break-word text-ink">{r.title}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <StatusChip tone={state.tone}>{state.chip}</StatusChip>
                      {state.note && <span className="text-sub text-muted">{state.note}</span>}
                    </span>
                  </span>
                }
                href={r.status === "DRAFT" ? to(`/requests/new?draft=${encodeURIComponent(r.id)}`) : to(`/requests/${encodeURIComponent(r.id)}`)}
              />
            );
          })}
        </List>
      </Card>
    </Section>
  );
}
