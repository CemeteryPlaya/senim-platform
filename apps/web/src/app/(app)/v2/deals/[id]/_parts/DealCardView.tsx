import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  Explain,
  HelpBlock,
  List,
  ListItem,
  ListRow,
  MoneyPanel,
  NowNext,
  PageTitle,
  Section,
  Split,
  Stack,
  StatusChip,
  Steps,
  TextLink,
  Timeline,
} from "@/kit";
import type { PartyContacts } from "@/modules/companies";
import type { Device } from "@/platform/device";
import { to } from "../../../../_shell/paths";
import type { DealStepsView, DealTone } from "../../../_parts/deal-summary";
import type { DocumentRow, MoneyView, NowView } from "./deal-card";
import { DealActions } from "./DealActions";

const t = ru.app.deal.card;

/** Всё, что нужно показать, готовым: страница читает модули, вид ничего не читает и не считает. */
export type CardView = {
  id: string;
  title: string;
  lead: string;
  chip: { text: string; tone: DealTone };
  now: NowView;
  steps: DealStepsView;
  money: MoneyView & { historyHref: string };
  order: { label: string; value: string }[];
  documents: DocumentRow[];
  master: { label: string; contacts: PartyContacts | null; chatHref: string };
  history: { items: { title: string; time: string }[]; more: boolean; allHref: string };
  actions: { cancelText: string | null; disputeHref: string | null };
};

function Progress({ steps }: { steps: DealStepsView }) {
  return (
    <Section title={t.steps.section}>
      <Card>
        {steps.kind === "steps" ? <Steps label={t.steps.section} items={steps.items} /> : <Steps label={t.steps.section} items={[]} stopped={{ label: steps.label }} />}
      </Card>
    </Section>
  );
}

function Money({ view, device }: { view: CardView; device: Device }) {
  const m = view.money;
  const e = t.money.explain;
  return (
    <Section title={t.money.section}>
      <MoneyPanel
        tone={m.tone}
        title={m.title}
        amount={m.amount}
        rows={m.rows.map(({ explain, ...row }) => (explain ? { ...row, explain: { label: e.label, title: e.title, body: <p>{e.body}</p> } } : row))}
        {...(m.note ? { note: m.note } : {})}
        action={{ label: t.money.history, href: m.historyHref }}
        device={device}
      />
    </Section>
  );
}

function Order({ view }: { view: CardView }) {
  return (
    <Section title={t.order.section}>
      <Card padded={false}>
        <List>
          {view.order.map((row) => (
            <ListRow key={row.label} label={row.label} value={row.value} stacked />
          ))}
        </List>
      </Card>
    </Section>
  );
}

/** Документ — строка-ссылка на PDF (обработчик `/api/documents/<id>/pdf`): обычная ссылка, без перехода роутера. */
function Documents({ view }: { view: CardView }) {
  const d = t.documents;
  return (
    <Section title={d.section}>
      {view.documents.length === 0 ? (
        <Card>
          <p className="text-body text-muted">{d.empty}</p>
        </Card>
      ) : (
        <Card padded={false}>
          <List>
            {view.documents.map((doc) => (
              <ListItem key={doc.id}>
                <a
                  href={doc.href}
                  target="_blank"
                  rel="noopener"
                  className="flex min-h-control w-full items-center justify-between gap-4 px-4 py-3 text-body no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-ink wrap-break-word">{doc.name}</span>
                    <span className="text-sub text-muted">{doc.status}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 font-medium text-ink">
                    {d.open}
                    <ChevronRight aria-hidden className="size-5 shrink-0 text-muted" />
                  </span>
                </a>
              </ListItem>
            ))}
          </List>
        </Card>
      )}
    </Section>
  );
}

/** Мастер: имя — как отдаёт модуль; контакты — только после оферты (`dealContacts`), до неё — строка с пояснением. */
function Master({ view, device }: { view: CardView; device: Device }) {
  const m = t.master;
  const { contacts } = view.master;
  return (
    <Section title={m.section}>
      <Card padded={false}>
        <List>
          <ListItem>
            <p className="px-4 py-3 text-card text-ink wrap-break-word">{view.master.label}</p>
          </ListItem>
          {contacts ? (
            <>
              <ListRow label={m.phone} value={contacts.phoneDisplay} href={`tel:${contacts.phone}`} />
              {contacts.instagram && (
                <ListRow label={m.instagram} value={contacts.instagram} href={`https://www.instagram.com/${encodeURIComponent(contacts.instagram)}/`} />
              )}
            </>
          ) : (
            <ListItem>
              <div className="flex flex-wrap items-baseline gap-x-2 px-4 py-3 text-body text-muted">
                <span>{m.hidden}</span>
                <Explain label={m.explain.label} title={m.explain.title} device={device}>
                  <p>{m.explain.body}</p>
                </Explain>
              </div>
            </ListItem>
          )}
        </List>
      </Card>
      <TextLink href={view.master.chatHref}>{m.write}</TextLink>
    </Section>
  );
}

function History({ view }: { view: CardView }) {
  const h = t.history;
  return (
    <Section title={h.section} id="history">
      <Card>
        {view.history.items.length === 0 ? <p className="text-body text-muted">{h.empty}</p> : <Timeline label={h.label} items={view.history.items} />}
      </Card>
      {view.history.more && <TextLink href={view.history.allHref}>{h.all}</TextLink>}
    </Section>
  );
}

function Help() {
  return (
    <HelpBlock
      items={[
        { question: t.help.money, href: to("/about") },
        { question: t.help.notLiked, href: to("/about") },
      ]}
      supportEmail={brand.support.email}
    />
  );
}

/**
 * Карточка сделки покупателя. Телефон — одна колонка в порядке важности: «Сейчас», ход, деньги, заказ, документы, мастер,
 * история, помощь; главное действие шага — в `ActionDock` последним. Компьютер — `Split`: слева процесс («Сейчас» с
 * действием под ним, ход, документы, мастер, история), справа деньги, заказ и помощь. Второстепенное — меню «Действия».
 */
export function DealCardView({ view, device }: { view: CardView; device: Device }) {
  const { now } = view;
  const primary = now.primary && <ButtonLink href={now.primary.href}>{now.primary.label}</ButtonLink>;
  const nowBlock: ReactNode = (
    <Stack>
      <NowNext now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }} {...(now.next ? { next: now.next } : {})} />
      {device === "desktop" && primary && <ActionDock>{primary}</ActionDock>}
      {now.link && <TextLink href={now.link.href}>{now.link.label}</TextLink>}
    </Stack>
  );
  const header = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1">
        <PageTitle
          title={view.title}
          back={{ href: to("/deals"), label: t.back }}
          lead={
            <span className="flex flex-col items-start gap-2">
              <span>{view.lead}</span>
              <StatusChip tone={view.chip.tone}>{view.chip.text}</StatusChip>
            </span>
          }
        />
      </div>
      <DealActions dealId={view.id} cancelText={view.actions.cancelText} disputeHref={view.actions.disputeHref} device={device} />
    </div>
  );

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {header}
        <Split
          main={
            <Stack gap="section">
              {nowBlock}
              <Progress steps={view.steps} />
              <Documents view={view} />
              <Master view={view} device={device} />
              <History view={view} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Money view={view} device={device} />
              <Order view={view} />
              <Help />
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {header}
      {nowBlock}
      <Progress steps={view.steps} />
      <Money view={view} device={device} />
      <Order view={view} />
      <Documents view={view} />
      <Master view={view} device={device} />
      <History view={view} />
      <Help />
      {primary && <ActionDock>{primary}</ActionDock>}
    </Stack>
  );
}
