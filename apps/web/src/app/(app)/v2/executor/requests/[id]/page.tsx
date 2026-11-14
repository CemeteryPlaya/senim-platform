import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  List,
  ListRow,
  NowNext,
  PageTitle,
  PhotoSlot,
  Section,
  Split,
  Stack,
  StatusChip,
  TextLink,
  Timeline,
} from "@/kit";
import type { CurrentUser } from "@/modules/identity";
import { getIncomingRequest, getNegotiation, TZ_PATH, type IncomingRequest, type NegotiationView } from "@/modules/requests";
import { getDevice, type Device } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireMaster } from "../../../../_shell/auth";
import { legacy, to } from "../../../../_shell/paths";
import { readForMaster, REGISTER } from "../../_parts/approved";
import { GATE_BACK, MasterGate } from "../../_parts/MasterGate";
import { AcceptButton, OfferMenu, ProposeButton, WithdrawPriceButton } from "./_parts/MasterOfferActions";
import { MasterMoney } from "./_parts/MasterMoney";
import { OfferForm } from "./_parts/OfferForm";
import { requestView, type RequestViewModel } from "./_parts/request-view";

const t = ru.app.masterOffer;

// В заголовке вкладки — только «Заявка»: название и номер заявки туда не идут.
export const metadata: Metadata = { title: t.metaTitle };

type Props = { params: Promise<{ id: string }> };

/**
 * Заявка и торг по своему предложению. Чужая и несуществующая заявка (модуль: не видна мастеру и своего предложения нет)
 * — 404. Заявка порядка «до оферты» (замер, залог, проект — флаг preContractFlows, в v2 не переносится) — сразу в v1, как
 * у чатов. Торг читается, когда своё предложение есть и форма не нужна.
 */
async function load(user: CurrentUser, id: string): Promise<{ request: IncomingRequest; negotiation: NegotiationView | null }> {
  let request: IncomingRequest;
  try {
    request = await getIncomingRequest(user, id);
  } catch (e) {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  }
  if (request.path !== TZ_PATH) redirect(legacy(`/executor/requests/${encodeURIComponent(id)}`));
  const composing = request.canOffer && (!request.myOffer || request.retryAllowed);
  const offer = request.myOffer;
  const negotiation = offer && !composing ? await getNegotiation(user, { offerId: offer.id }) : null;
  return { request, negotiation };
}

/** Главное действие торга (не больше одного) — единственная кнопка дока. У формы своя кнопка: её док рисует форма. */
function Actions({ view, device }: { view: RequestViewModel; device: Device }) {
  const { primary, offerId } = view;
  if (!primary || primary.kind === "send") return null;
  return (
    <ActionDock>
      {primary.kind === "accept" && offerId && (
        <AcceptButton
          device={device}
          offerId={offerId}
          proposalId={primary.proposalId}
          label={primary.label}
          confirmTitle={primary.confirmTitle}
          confirmDescription={primary.confirmDescription}
        />
      )}
      {primary.kind === "propose" && offerId && <ProposeButton device={device} offerId={offerId} primary description={view.proposeDescription} />}
      {primary.kind === "deal" && <ButtonLink href={primary.href}>{primary.label}</ButtonLink>}
    </ActionDock>
  );
}

/**
 * Второстепенное действие («Предложить свою цену», «Отозвать мою цену» или ссылка) — тихой кнопкой-ссылкой по левой линии;
 * под ним — переписка («Написать покупателю», у закрытого торга — «Переписка»). Обёртка-ряд: в колонке кнопка растянулась
 * бы на всю ширину.
 */
function Secondary({ view, device }: { view: RequestViewModel; device: Device }) {
  const { secondary, offerId } = view;
  const chat = view.chat && <TextLink href={view.chat.href}>{view.chat.label}</TextLink>;
  if (!secondary) return chat || null;
  const action =
    secondary.kind === "link" ? (
      <TextLink href={secondary.href}>{secondary.label}</TextLink>
    ) : (
      offerId && (
        <div className="flex">
          {secondary.kind === "propose" ? (
            <ProposeButton device={device} offerId={offerId} primary={false} description={view.proposeDescription} />
          ) : (
            <WithdrawPriceButton device={device} offerId={offerId} proposalId={secondary.proposalId} />
          )}
        </div>
      )
    );
  return (
    <div className="flex flex-col">
      {action}
      {chat}
    </div>
  );
}

/** Что нужно покупателю: сводка, фото помещения, строка о контактах покупателя (у закрытого торга её нет). */
function Request({ view }: { view: RequestViewModel }) {
  return (
    <Section title={t.request.title}>
      <Card padded={false}>
        <List>
          {view.details.map((row) => (
            <ListRow key={row.label} label={row.label} value={row.value} stacked={row.stacked} />
          ))}
        </List>
      </Card>
      {view.photos.length > 0 && (
        <Card>
          <Stack>
            <h3 className="text-sub text-muted">{t.request.photos}</h3>
            <ul className="grid grid-cols-3 gap-2">
              {view.photos.map((photo) => (
                <li key={photo.id}>
                  <PhotoSlot ratio="1/1" src={photo.src} alt={photo.alt} />
                </li>
              ))}
            </ul>
          </Stack>
        </Card>
      )}
      {view.contactsNote && <p className="text-sub text-muted">{view.contactsNote}</p>}
    </Section>
  );
}

function Conditions({ view }: { view: RequestViewModel }) {
  if (view.conditions.length === 0) return null;
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

function History({ view }: { view: RequestViewModel }) {
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

/** Заголовок: название заявки, номер и «Прямая заявка вам»; «Назад» — к заявкам; меню отзыва — справа, пока торг идёт. */
function Title({ view, device }: { view: RequestViewModel; device: Device }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <PageTitle
          title={view.title}
          back={view.back}
          lead={
            <span className="flex flex-col items-start gap-2">
              <span>{view.lead.number}</span>
              {view.lead.direct && <StatusChip tone="accent">{view.lead.direct}</StatusChip>}
            </span>
          }
        />
      </div>
      {view.withdrawOffer && <OfferMenu device={device} offerId={view.withdrawOffer.offerId} />}
    </div>
  );
}

/**
 * Заявка глазами мастера (`/v2/executor/requests/<id>`): что нужно покупателю, форма предложения с живым расчётом
 * «Вы получите», затем торг цены зеркально экрану покупателя (принять цену покупателя — сделка с офертой; своя цена;
 * отозвать цену или предложение целиком). Первая карточка — «Сейчас / Дальше», одно главное действие. Покупатель не
 * назван: имя и контакты, адрес и точку модуль отдаёт только после того, как цена принята. Смета — `partyEstimate
 * ("EXECUTOR")` модуля: мастер видит цену, «Гарантия оплаты и клиента (4%)» и «Вы получите»; защиты сделки и суммы к
 * оплате покупателя здесь нет. Неодобренный мастер — экран статуса. Замер, залог и проект (флаг preContractFlows) не
 * переносятся: такая заявка сразу уводит в v1.
 * Телефон — одна колонка, главное действие в доке последним; компьютер — `Split`: слева «Сейчас», торг и заявка, справа
 * деньги (или форма) и своё предложение.
 */
export default async function MasterRequestPage({ params }: Props) {
  const { id } = await params;
  const { user, status } = await requireMaster(to(`/executor/requests/${encodeURIComponent(id)}`));
  const device = await getDevice();
  const read = await readForMaster(user, status, () => load(user, id));
  if ("gate" in read) {
    if (read.gate === "none") redirect(REGISTER);
    return <MasterGate status={read.gate} title={t.gateTitle} device={device} back={GATE_BACK} />;
  }

  const { request, negotiation } = read.data;
  const view = requestView(request, negotiation);
  const title = <Title view={view} device={device} />;
  const now = <NowNext now={view.now} {...(view.next ? { next: view.next } : {})} />;
  const secondary = <Secondary view={view} device={device} />;
  const money = view.money && <MasterMoney money={view.money} device={device} />;
  const form = view.primary?.kind === "send" && <OfferForm requestId={request.id} device={device} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          main={
            <Stack gap="section">
              <Stack>
                {now}
                <Actions view={view} device={device} />
                {secondary}
              </Stack>
              <Request view={view} />
              <History view={view} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              {form || money}
              <Conditions view={view} />
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Stack gap="tight">
        {now}
        {secondary}
      </Stack>
      {money}
      <Conditions view={view} />
      <Request view={view} />
      <History view={view} />
      {form}
      <Actions view={view} device={device} />
    </Stack>
  );
}
