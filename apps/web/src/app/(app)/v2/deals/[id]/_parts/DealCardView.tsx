import { ChevronDown, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  cn,
  Explain,
  HelpBlock,
  List,
  ListItem,
  ListRow,
  MoneyPanel,
  NowNext,
  PageTitle,
  Progress,
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
import { HELP_ANCHORS } from "../../../help/anchors";
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

/** Сколько строк «Заказа» видно на телефоне до «Показать всё». */
const ORDER_SHOWN_MOBILE = 3;

/** Ссылка на файл (PDF): обычная ссылка без перехода роутера, вид — как у `TextLink`. */
const FILE_LINK = "inline-flex min-h-control w-fit items-center gap-1 text-body font-medium text-ink no-underline hover:underline";

/**
 * Раскрытие по нажатию (нативный `<details>`: клавиатура и диктор без скриптов). Подпись — как у `TextLink`; раскрытое
 * содержимое встаёт на место подписи.
 */
function More({ label, children, className, summaryClassName }: { label: string; children: ReactNode; className?: string; summaryClassName?: string }) {
  return (
    <details className={cn("group", className)}>
      <summary
        className={cn(
          "flex min-h-control w-fit cursor-pointer list-none items-center gap-1 text-body font-medium text-ink hover:underline group-open:hidden",
          summaryClassName,
        )}
      >
        {label}
        <ChevronDown aria-hidden className="size-4 shrink-0" />
      </summary>
      {children}
    </details>
  );
}

/** Ход сделки. Компьютер — полная шкала. Телефон — компактно: «Шаг N из 5» с полосой, полная шкала — по нажатию. */
function Progression({ steps, device }: { steps: DealStepsView; device: Device }) {
  const label = t.steps.section;
  if (steps.kind === "stopped") {
    return (
      <Section title={label}>
        <Card>
          <Steps label={label} items={[]} stopped={{ label: steps.label }} />
        </Card>
      </Section>
    );
  }
  return (
    <Section title={label}>
      <Card>
        {device === "desktop" ? (
          <Steps label={label} items={steps.items} />
        ) : (
          <Stack gap="tight">
            <p className="text-body text-ink">{steps.caption}</p>
            <Progress value={steps.done} max={steps.total} label={label} />
            <More label={t.steps.all}>
              <div className="pt-3">
                <Steps label={label} items={steps.items} />
              </div>
            </More>
          </Stack>
        )}
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
      {m.proof && <p className="text-sub text-muted">{m.proof}</p>}
    </Section>
  );
}

function OrderRows({ rows }: { rows: CardView["order"] }) {
  return (
    <List>
      {rows.map((row) => (
        <ListRow key={row.label} label={row.label} value={row.value} stacked />
      ))}
    </List>
  );
}

/** «Заказ». Телефон — первые строки и «Показать всё»; компьютер — все строки. */
function Order({ view, device }: { view: CardView; device: Device }) {
  const head = device === "mobile" ? view.order.slice(0, ORDER_SHOWN_MOBILE) : view.order;
  const rest = device === "mobile" ? view.order.slice(ORDER_SHOWN_MOBILE) : [];
  return (
    <Section title={t.order.section}>
      <Card padded={false}>
        <OrderRows rows={head} />
        {rest.length > 0 && (
          // Разделитель с отступом 16 px слева — как у строк списка.
          <More
            label={t.order.all}
            className="relative before:absolute before:top-0 before:right-0 before:left-4 before:border-t before:border-line"
            summaryClassName="px-4"
          >
            <OrderRows rows={rest} />
          </More>
        )}
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
        { question: t.help.money, href: `${to("/help")}#${HELP_ANCHORS.money}` },
        { question: t.help.notLiked, href: `${to("/help")}#${HELP_ANCHORS.notFit}` },
      ]}
      supportEmail={brand.support.email}
    />
  );
}

/**
 * Карточка сделки покупателя. Телефон — одна колонка в порядке важности: «Сейчас», деньги, ход (компактно), заказ,
 * документы, мастер, история, помощь; главное действие шага — в `ActionDock` последним. Компьютер — `Split`: слева
 * процесс («Сейчас» с действием под ним, ход, документы, мастер, история), справа деньги, заказ и помощь.
 * Второстепенное — меню «Действия».
 */
export function DealCardView({ view, device }: { view: CardView; device: Device }) {
  const { now } = view;
  const primary = now.primary && <ButtonLink href={now.primary.href}>{now.primary.label}</ButtonLink>;
  const link =
    now.link &&
    (now.link.external ? (
      <a href={now.link.href} target="_blank" rel="noopener" className={FILE_LINK}>
        {now.link.label}
        <ChevronRight aria-hidden className="size-4 shrink-0" />
      </a>
    ) : (
      <TextLink href={now.link.href}>{now.link.label}</TextLink>
    ));
  const nowBlock: ReactNode = (
    <Stack>
      <NowNext now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }} {...(now.next ? { next: now.next } : {})} />
      {device === "desktop" && primary && <ActionDock>{primary}</ActionDock>}
      {link}
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
              <Progression steps={view.steps} device={device} />
              <Documents view={view} />
              <Master view={view} device={device} />
              <History view={view} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Money view={view} device={device} />
              <Order view={view} device={device} />
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
      <Money view={view} device={device} />
      <Progression steps={view.steps} device={device} />
      <Order view={view} device={device} />
      <Documents view={view} />
      <Master view={view} device={device} />
      <History view={view} />
      <Help />
      {primary && <ActionDock>{primary}</ActionDock>}
    </Stack>
  );
}
