import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  List,
  ListRow,
  MoneyPanel,
  NowNext,
  PageTitle,
  Rating,
  Section,
  Split,
  Stack,
  TextLink,
  Timeline,
} from "@/kit";
import type { CurrentUser } from "@/modules/identity";
import { getNegotiation, getOfferForClient } from "@/modules/requests";
import { getDevice, type Device } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireBuyer } from "../../../../../_shell/auth";
import { to } from "../../../../../_shell/paths";
import { AcceptButton, ProposeButton, WithdrawButton } from "./_parts/OfferActions";
import { offerView, type OfferViewModel } from "./_parts/offer-view";

const t = ru.app.offer;

// В заголовке вкладки — только «Предложение мастера»: подпись мастера (в режиме «имя показано» — наименование) туда не идёт.
export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string; offerId: string }> };

/** Предложение и торг одного отклика своей заявки. Чужая или несуществующая заявка, чужое или отозванное предложение — 404. */
async function load(user: CurrentUser, requestId: string, offerId: string) {
  try {
    const offer = await getOfferForClient(user, { requestId, offerId });
    const negotiation = await getNegotiation(user, { offerId: offer.id });
    return { offer, negotiation };
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
}

/** Главное действие (не больше одного) и тихое рядом: в доке; дети дока — кнопки напрямую. */
function Actions({ view, device, offerId }: { view: OfferViewModel; device: Device; offerId: string }) {
  const { primary, secondary } = view;
  if (!primary) return null;
  return (
    <ActionDock>
      {primary.kind === "accept" && (
        <AcceptButton
          device={device}
          offerId={offerId}
          proposalId={primary.proposalId}
          label={primary.label}
          confirmTitle={primary.confirmTitle}
          confirmDescription={primary.confirmDescription}
        />
      )}
      {primary.kind === "propose" && <ProposeButton device={device} offerId={offerId} primary />}
      {primary.kind === "deal" && <ButtonLink href={primary.href}>{primary.label}</ButtonLink>}
      {secondary?.kind === "propose" && <ProposeButton device={device} offerId={offerId} primary={false} />}
    </ActionDock>
  );
}

/** «Сейчас / Дальше»; без главного действия второстепенное («Отозвать предложение») — тихой кнопкой под карточкой. */
function Now({ view, device }: { view: OfferViewModel; device: Device }) {
  return (
    <Stack gap="tight">
      <NowNext now={view.now} next={view.next} />
      {/* Обёртка-ряд: в колонке кнопка растянулась бы на всю ширину, подпись встала бы по центру, а не по левой линии. */}
      {view.secondary?.kind === "withdraw" && (
        <div className="flex">
          <WithdrawButton device={device} proposalId={view.secondary.proposalId} />
        </div>
      )}
    </Stack>
  );
}

/** Смета покупателя: «К оплате» крупно, цена, «Защита сделки (2%)» с пояснением, итог. Суммы — из модуля. */
function Money({ view, device }: { view: OfferViewModel; device: Device }) {
  const money = view.money;
  if (!money) return null;
  const explain = {
    label: t.money.explain.label,
    title: t.money.explain.title,
    body: (
      <Stack>
        {t.money.explain.paragraphs.map((text) => (
          <p key={text} className="text-body text-ink">
            {text}
          </p>
        ))}
      </Stack>
    ),
  };
  return (
    <MoneyPanel
      tone="awaiting"
      title={money.title}
      amount={money.amountTiyn}
      rows={money.rows.map((row) => ({
        label: row.label,
        amount: row.amountTiyn,
        ...(row.total ? { total: true } : {}),
        ...(row.explain ? { explain } : {}),
      }))}
      note={money.note}
      device={device}
    />
  );
}

function Conditions({ view }: { view: OfferViewModel }) {
  return (
    <Section title={t.conditions.title}>
      <Card padded={false}>
        <List>
          {view.conditions.map((row) => (
            <ListRow
              key={row.label}
              label={row.label}
              stacked={row.stacked}
              value={row.stacked ? <span className="whitespace-pre-line">{row.value}</span> : row.value}
            />
          ))}
        </List>
      </Card>
    </Section>
  );
}

/** Об исполнителе: рейтинг и сделки; профиль с работами и переписка — ссылками. Имени и контактов здесь нет. */
function Executor({ view }: { view: OfferViewModel }) {
  const ex = view.executor;
  return (
    <Section title={t.executor.title}>
      <Card padded={false}>
        <List>
          <ListRow label={t.executor.rating} value={<Rating value={ex.rating.value} count={ex.rating.count} />} />
          <ListRow label={t.executor.deals} value={String(ex.deals)} />
        </List>
        <div className="flex flex-col border-t border-line px-4">
          <TextLink href={ex.profileHref}>{t.actions.profile}</TextLink>
          <TextLink href={view.chatHref}>{t.actions.chat}</TextLink>
        </div>
      </Card>
    </Section>
  );
}

function History({ view }: { view: OfferViewModel }) {
  if (view.history.length === 0) return null;
  return (
    <Section title={t.history.title}>
      <Card>
        <Timeline
          label={t.history.title}
          items={view.history.map((item) => ({ title: item.title, time: item.time, text: item.text, amount: item.amountTiyn }))}
        />
      </Card>
    </Section>
  );
}

/**
 * Предложение мастера и торг цены (путь ТЗ, ADR-009): покупатель принимает цену — создаётся сделка с офертой.
 * Первая карточка — «Сейчас / Дальше» по состоянию торга (`offerState`), одно главное действие: «Принять X», «Предложить
 * свою цену» (когда открытой цены нет) или «Открыть сделку». Смета — `partyEstimate` модуля (цена, защита 2% вверх до
 * тиына, к оплате). Мастер — «Исполнитель №N» (как отдаёт модуль), без контактов. Чата здесь нет — ссылка на экран
 * переписки. Выбор без торга и «Показать телефон» (флаги preContractFlows, clientPhoneConsent) не переносятся.
 * Телефон — одна колонка, действие в доке последним; компьютер — `Split`: слева торг и условия, справа деньги и мастер.
 */
export default async function OfferPage({ params }: Props) {
  const { id, offerId } = await params;
  const user = await requireBuyer(to(`/requests/${encodeURIComponent(id)}/offers/${encodeURIComponent(offerId)}`));
  const { offer, negotiation } = await load(user, id, offerId);
  const device = await getDevice();
  const view = offerView(offer, negotiation);
  const title = <PageTitle title={view.title} back={view.back} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              <Stack>
                <Now view={view} device={device} />
                <Actions view={view} device={device} offerId={offer.id} />
              </Stack>
              <Conditions view={view} />
              <History view={view} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Money view={view} device={device} />
              <Executor view={view} />
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Now view={view} device={device} />
      <Money view={view} device={device} />
      <Conditions view={view} />
      <Executor view={view} />
      <History view={view} />
      <Actions view={view} device={device} offerId={offer.id} />
    </Stack>
  );
}
