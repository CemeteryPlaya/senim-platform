import { ChevronDown, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { brand } from "@/config/brand";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  cn,
  ContactActions,
  CopyButton,
  Explain,
  HelpBlock,
  List,
  ListItem,
  ListRow,
  MapLink,
  MoneyPanel,
  Notice,
  NowNext,
  PageTitle,
  PhotoGallery,
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
import type { DealSide } from "../../../../_shell/side";
import type { DealCover } from "../../../_parts/deal-cover";
import { DealCoverCaption, DealCoverPhoto } from "../../../_parts/DealCoverPhoto";
import type { DesignView } from "../../../_parts/design-files";
import { DesignFiles } from "../../../_parts/DesignFiles";
import type { DealStepsView, DealTone } from "../../../_parts/deal-summary";
import type { DeliveryView, DocumentRow, MoneyView, NowView, OrderRow, ReportView } from "./deal-card";
import { dealHelpItems } from "../../_parts/help-items";
import { DealActions } from "./DealActions";

const t = ru.app.deal.card;
const tm = ru.app.masterDeal.card;

/** Всё, что нужно показать, готовым: страница читает модули, вид ничего не читает и не считает. */
export type CardView = {
  id: string;
  /** Чьими глазами: покупатель или мастер (`partyDeal`) — от неё подписи блоков денег, другой стороны и отзыва. */
  side: DealSide;
  title: string;
  lead: string;
  /** Номер сделки; копируется как «Сделка №6». Без него кнопки «Скопировать» нет. */
  number?: number;
  /**
   * Плашка статуса — только у оконченной сделки (завершена, отменена, возврат): у идущей текущий шаг называют «Сейчас» и
   * капсула шага на фото; `null` — плашки нет.
   */
  chip: { text: string; tone: DealTone } | null;
  now: NowView;
  steps: DealStepsView;
  /**
   * Обложка — последнее фото отчёта хода работ (`coverOf`, Ruling 6); `null` — отчётов с фото нет, карточка без обложки.
   * По нажатию — снимки этого отчёта на весь экран; в «Ходе работ» обложка второй раз не показывается.
   */
  cover: DealCover | null;
  /** Блок денег карточки (`place: "card"`); `historyHref` — `null`, пока в журнале нет операций (история денег пуста). */
  money: MoneyView & { historyHref: string | null };
  /** «Заказ»: 2–3 строки (`orderRows`) — все видны сразу. */
  order: OrderRow[];
  /** Свой дизайн-проект покупателя из заявки — обеим сторонам, под «Заказом» (без скрытых оператором); нет файлов — нет. */
  design?: DesignView | null;
  documents: DocumentRow[];
  /**
   * Другая сторона: мастеру — покупатель, покупателю — мастер; контакты — после оферты. Имени строкой в разделе нет: имя
   * мастера — под заголовком экрана, раздел называет сторону.
   */
  party: { contacts: PartyContacts | null; chatHref: string };
  /** «Ход работ» мастера: отчёты и ссылка «Добавить отчёт» (`null` — не добавить); у покупателя блока нет (`null`). */
  reports: { items: ReportView[]; addHref: string | null } | null;
  /** «Сдача работы»: фото результата и место сдачи (`deliveryView`) — обеим сторонам; не сдано — нет. */
  delivery?: DeliveryView | null;
  /** «История»: показывается с двух событий (одно «Сделка создана» ничего не сообщает). */
  history: { items: { title: string; time: string }[]; more: boolean; allHref: string };
  /** Оставленный отзыв строками; `null` — отзыва нет. */
  review: { label: string; value: string; stacked: boolean }[] | null;
  /** Покупателю оконченной сделки с офертой, когда он уже выбирал (после отзыва): строка выбора показа в профиле мастера; иначе нет. */
  showcase?: { text: string; href: string } | null;
  actions: { cancelText: string | null; disputeHref: string | null };
};

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

/** Сделка идёт: шкала шагов есть и не все шаги пройдены. Остановленная (спор, отмена, возврат) и завершённая — нет. */
const running = (steps: DealStepsView): steps is Extract<DealStepsView, { kind: "steps" }> => steps.kind === "steps" && steps.done < steps.total;

/**
 * Ход сделки — только у идущей сделки (у остановленной и завершённой о состоянии говорят «Сейчас» и деньги). Компьютер —
 * полная шкала. Телефон — компактно: «Шаг N из 5» с полосой, полная шкала — по нажатию; подписи шага нет, когда она уже на
 * обложке (`captionOnCover`).
 */
function Progression({ steps, device, captionOnCover = false }: { steps: DealStepsView; device: Device; captionOnCover?: boolean }) {
  const label = t.steps.section;
  if (!running(steps)) return null;
  return (
    <Section title={label}>
      <Card>
        {device === "desktop" ? (
          <Steps label={label} items={steps.items} />
        ) : (
          <Stack gap="tight">
            {!captionOnCover && <p className="text-body text-ink">{steps.caption}</p>}
            <Progress value={steps.done} max={steps.total} label={label} segmented />
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

/**
 * Деньги: одна сумма крупно; пояснение «Что это?» — у строки (гарантия мастеру) или в конце примечания (покупателю). Заголовок
 * раздела — только для диктора: зелёный блок с суммой сам себя называет, а на компьютере встаёт вровень с левой колонкой.
 * «История денег» — с первой операции в журнале.
 */
function Money({ view, device }: { view: CardView; device: Device }) {
  const m = view.money;
  const label = view.side === "EXECUTOR" ? tm.money.explain.label : t.money.explain.label;
  const explain = m.explain && { label, title: m.explain.title, body: <p>{m.explain.body}</p> };
  const atRow = m.rows.some((row) => row.explain);
  return (
    <section aria-labelledby="deal-money" className="flex min-w-0 flex-col gap-stack-group">
      <h2 id="deal-money" className="sr-only">
        {t.money.section}
      </h2>
      <MoneyPanel
        tone={m.tone}
        title={m.title}
        amount={m.amount}
        rows={m.rows.map(({ explain: here, ...row }) => (here && explain ? { ...row, explain } : row))}
        {...(m.note ? { note: m.note } : {})}
        {...(explain && !atRow ? { noteExplain: explain } : {})}
        {...(m.historyHref ? { action: { label: t.money.history, href: m.historyHref } } : {})}
        device={device}
      />
    </section>
  );
}

/** Ширина обложки: на компьютере — основная колонка `Split`, на телефоне — экран. */
const COVER_SIZES = "(min-width: 64rem) 720px, 100vw";

/** Отчёт, чьё первое фото — обложка (`coverOf`: самый свежий отчёт с фото). */
function coverReport(view: CardView): ReportView | null {
  const src = view.cover?.src;
  if (!src) return null;
  return view.reports?.items.find((report) => report.photos[0]?.src === src) ?? null;
}

const photoCaption = (report: ReportView) => [report.title, report.time].filter(Boolean).join(" · ");

/**
 * Обложка карточки: фото последнего отчёта; на нём шаг идущей сделки капсулой (остановленная и завершённая — без капсулы). По
 * нажатию — снимки этого отчёта на весь экран (листаются).
 */
function Cover({ cover, steps, report }: { cover: DealCover; steps: DealStepsView; report: ReportView | null }) {
  const caption = running(steps) ? steps.caption : null;
  if (!report) return <DealCoverPhoto cover={cover} caption={caption} sizes={COVER_SIZES} className="rounded-card" />;
  return (
    <PhotoGallery
      layout="cover"
      label={report.title}
      sizes={COVER_SIZES}
      photos={report.photos.map((photo) => ({ src: photo.src, alt: photo.alt, caption: photoCaption(report) }))}
      overlay={caption ? <DealCoverCaption caption={caption} /> : null}
    />
  );
}

function OrderRows({ rows }: { rows: CardView["order"] }) {
  return (
    <List>
      {rows.map((row) => (
        <ListRow
          key={row.label}
          label={row.label}
          value={
            row.map || row.link ? (
              <span className="flex flex-col items-start">
                <span>{row.value}</span>
                {row.map && <MapLink point={row.map.point} address={row.map.address} />}
                {row.link && <TextLink href={row.link.href}>{row.link.label}</TextLink>}
              </span>
            ) : (
              row.value
            )
          }
          stacked
        />
      ))}
    </List>
  );
}

/** «Заказ»: 2–3 строки условий — все сразу на телефоне и компьютере. Под ними — дизайн-проект покупателя. */
function Order({ view }: { view: CardView }) {
  return (
    <Section title={t.order.section}>
      <Card padded={false}>
        <OrderRows rows={view.order} />
      </Card>
      {view.design && <DesignFiles title={t.design.title} view={view.design} />}
    </Section>
  );
}

/**
 * Документ — строка-ссылка на PDF в новой вкладке (обработчик `/api/documents/<id>/pdf`): обычная ссылка, без перехода
 * роутера. Справа — только значок ↗ («Открыть оферту» и «в новой вкладке» — для диктора); статус подписи — у документов,
 * которые подписываются.
 */
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
                  rel="noopener noreferrer"
                  className="flex min-h-control w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-card py-3 text-body no-underline transition-colors duration-100 hover:bg-canvas active:bg-line"
                >
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="text-ink wrap-break-word">{doc.name}</span>
                    {doc.status && <span className="text-sub text-muted">{doc.status}</span>}
                  </span>
                  <span className="ml-auto flex shrink-0 items-center">
                    <span className="sr-only">
                      {doc.open} ({ru.app.kit.externalHint})
                    </span>
                    <ExternalLink aria-hidden className="size-5 shrink-0 text-muted" />
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

/**
 * Другая сторона: покупателю — мастер, мастеру — покупатель; имени здесь нет (имя мастера — под заголовком экрана).
 * Контакты — только после оферты (`dealContacts`), до неё — строка с пояснением.
 */
function Party({ view, device }: { view: CardView; device: Device }) {
  const m = view.side === "EXECUTOR" ? tm.buyer : t.master;
  const { contacts } = view.party;
  return (
    <Section title={m.section}>
      <Card padded={false}>
        <List>
          {contacts ? (
            <>
              <ListRow label={m.phone} value={contacts.phoneDisplay} />
              <ListItem>
                <ContactActions phone={contacts.phone} phoneDisplay={contacts.phoneDisplay} />
              </ListItem>
              {contacts.instagram && (
                <ListRow label={m.instagram} value={contacts.instagram} href={`https://www.instagram.com/${encodeURIComponent(contacts.instagram)}/`} />
              )}
            </>
          ) : (
            <ListItem>
              <div className="flex flex-wrap items-baseline gap-x-2 px-card py-3 text-body text-muted">
                <span>{m.hidden}</span>
                <Explain label={m.explain.label} title={m.explain.title} device={device}>
                  <p>{m.explain.body}</p>
                </Explain>
              </div>
            </ListItem>
          )}
        </List>
      </Card>
      <TextLink href={view.party.chatHref}>{m.write}</TextLink>
    </Section>
  );
}

/**
 * «Ход работ»: отчёты мастера свежими сверху (название, время, текст, лента фото 4 : 3 — по нажатию снимок открывается на весь
 * экран, листается) — обеим сторонам; мастеру ещё ссылка на экран нового отчёта и пустое состояние (покупателю пустой блок
 * не показывается). Фото обложки (`coverId` — её отчёт) в ленте второй раз не показывается: оно уже вверху экрана.
 */
function Reports({ reports, coverId }: { reports: NonNullable<CardView["reports"]>; coverId: string | null }) {
  const r = tm.reports;
  return (
    <Section title={t.reports.section}>
      {reports.items.length === 0 ? (
        <Card>
          <p className="text-body text-muted">{r.empty}</p>
        </Card>
      ) : (
        <Card padded={false}>
          <List>
            {reports.items.map((report) => {
              const photos = report.id === coverId ? report.photos.slice(1) : report.photos;
              return (
                <ListItem key={report.id}>
                  <div className="flex flex-col gap-2 px-card py-3">
                    <h3 className="text-headline text-ink wrap-break-word">{report.title}</h3>
                    <p className="text-sub text-muted">{report.time}</p>
                    {report.text && <p className="text-body whitespace-pre-line text-ink wrap-break-word">{report.text}</p>}
                    {photos.length > 0 && (
                      <PhotoGallery
                        layout="strip"
                        label={report.title}
                        photos={photos.map((photo) => ({ src: photo.src, alt: photo.alt, caption: photoCaption(report) }))}
                      />
                    )}
                  </div>
                </ListItem>
              );
            })}
          </List>
        </Card>
      )}
      {reports.addHref && <TextLink href={reports.addHref}>{r.add}</TextLink>}
    </Section>
  );
}

/**
 * «Сдача работы»: когда сдано, где (в радиусе от адреса заказа или дальше — тогда предупреждение) и фото результата лентой
 * 4 : 3 (по нажатию — на весь экран). Покупатель видит, что сдано, до подписи акта.
 */
function Delivery({ delivery }: { delivery: DeliveryView }) {
  const d = t.delivery;
  return (
    <Section title={d.section} id="delivery">
      <Card>
        <div className="flex flex-col gap-3">
          <p className="text-sub text-muted">{delivery.time}</p>
          {delivery.far ? <Notice tone="warn">{delivery.place}</Notice> : <p className="text-body text-ink">{delivery.place}</p>}
          {delivery.photos.length > 0 && (
            <PhotoGallery
              layout="strip"
              label={d.photosLabel}
              photos={delivery.photos.map((photo) => ({ src: photo.src, alt: photo.alt, caption: [d.section, delivery.time].join(" · ") }))}
            />
          )}
        </div>
      </Card>
    </Section>
  );
}

function Review({ rows, side }: { rows: NonNullable<CardView["review"]>; side: DealSide }) {
  return (
    <Section title={side === "EXECUTOR" ? tm.review.section : t.review.section}>
      <Card padded={false}>
        <List>
          {rows.map((row) => (
            <ListRow key={row.label} label={row.label} value={row.value} stacked={row.stacked} />
          ))}
        </List>
      </Card>
    </Section>
  );
}

/** «Показ в профиле мастера: …» одной строкой и ссылка «Изменить». */
function ShowcaseRow({ showcase }: { showcase: NonNullable<CardView["showcase"]> }) {
  return (
    <p className="flex flex-wrap items-center gap-x-3 text-body text-ink">
      <span>{showcase.text}</span>
      <TextLink href={showcase.href}>{ru.app.deal.showcase.change}</TextLink>
    </p>
  );
}

function History({ view }: { view: CardView }) {
  const h = t.history;
  // Одно событие («Сделка создана») ничего не сообщает — раздел появляется со второго.
  if (view.history.items.length < 2 && !view.history.more) return null;
  return (
    <Section title={h.section} id="history">
      <Card>
        <Timeline label={h.label} items={view.history.items} />
      </Card>
      {view.history.more && <TextLink href={view.history.allHref}>{h.all}</TextLink>}
    </Section>
  );
}

function Help({ side }: { side: DealSide }) {
  return (
    <HelpBlock
      items={dealHelpItems(side)}
      supportEmail={brand.support.email}
    />
  );
}

/**
 * Карточка сделки стороны (покупатель или мастер — `view.side`). Телефон — одна колонка в порядке важности: «Сейчас»,
 * деньги, ход (компактно), ход работ, заказ, документы, другая сторона, история, помощь; главное действие шага —
 * в `ActionDock` последним. Есть фото отчёта — фото-герой: обложка сразу под заголовком, под ней сумма, затем «Сейчас»,
 * ход работ и ход сделки. Компьютер — `Split`: слева процесс (обложка, «Сейчас» с действием внутри, ход, ход работ,
 * документы, другая сторона, история), справа деньги, заказ и помощь. Второстепенное — меню «Действия» («…» в строке
 * заголовка). Завершённой сделке без шага карточка «Сейчас» не нужна: о ней говорят плашка и сумма.
 */
export function DealCardView({ view, device }: { view: CardView; device: Device }) {
  const { now } = view;
  const showNow = now.kind !== "done";
  const primary = now.primary && <ButtonLink href={now.primary.href}>{now.primary.label}</ButtonLink>;
  const link = now.link && (
    <TextLink href={now.link.href} external={now.link.external === true}>
      {now.link.label}
    </TextLink>
  );
  const nowBlock: ReactNode = showNow && (
    <Stack>
      {/* Компьютер: главное действие внутри карточки «Сейчас» (разбор 3.6); телефон — в доке в конце экрана. */}
      <NowNext
        now={{ title: now.title, ...(now.body ? { body: now.body } : {}) }}
        {...(now.next ? { next: now.next } : {})}
        action={device === "desktop" && primary ? <ActionDock>{primary}</ActionDock> : null}
      />
      {link}
    </Stack>
  );
  const hasActions = view.actions.cancelText !== null || view.actions.disputeHref !== null;
  // «…» — в строке заголовка справа от названия (разбор 3.7), без стекла: строка заголовка в покое не плавает.
  const header = (
    <PageTitle
      title={view.title}
      back={{ href: to("/deals"), label: t.back }}
      trailing={hasActions && <DealActions dealId={view.id} cancelText={view.actions.cancelText} disputeHref={view.actions.disputeHref} device={device} />}
      lead={
        <span className="flex flex-col items-start gap-2">
          <span className="flex items-center gap-1">
            <span>{view.lead}</span>
            {view.number !== undefined && <CopyButton value={tm.lead(view.number)} label={t.copyNumber} />}
          </span>
          {view.chip && <StatusChip tone={view.chip.tone}>{view.chip.text}</StatusChip>}
        </span>
      }
    />
  );
  const fromCover = coverReport(view);
  const cover = view.cover && <Cover cover={view.cover} steps={view.steps} report={fromCover} />;
  const reports = view.reports && <Reports reports={view.reports} coverId={fromCover?.id ?? null} />;
  const delivery = view.delivery && <Delivery delivery={view.delivery} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {header}
        <Split
          main={
            <Stack gap="section">
              {cover}
              {nowBlock}
              <Progression steps={view.steps} device={device} />
              {delivery}
              {reports}
              <Documents view={view} />
              <Party view={view} device={device} />
              {view.review && <Review rows={view.review} side={view.side} />}
              {view.showcase && <ShowcaseRow showcase={view.showcase} />}
              <History view={view} />
            </Stack>
          }
          aside={
            <Stack gap="section">
              <Money view={view} device={device} />
              <Order view={view} />
              <Help side={view.side} />
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {header}
      {cover ? (
        // Фото-герой (разбор 3.1): обложка сразу под заголовком, сумма — сразу под обложкой, «Ход работ» лентой — до хода
        // сделки и «Заказа».
        <>
          <Stack>
            {cover}
            <Money view={view} device={device} />
          </Stack>
          {nowBlock}
          {delivery}
          {reports}
          <Progression steps={view.steps} device={device} captionOnCover />
        </>
      ) : (
        <>
          {nowBlock}
          <Money view={view} device={device} />
          <Progression steps={view.steps} device={device} />
          {delivery}
          {reports}
        </>
      )}
      <Order view={view} />
      <Documents view={view} />
      <Party view={view} device={device} />
      {view.review && <Review rows={view.review} side={view.side} />}
      {view.showcase && <ShowcaseRow showcase={view.showcase} />}
      <History view={view} />
      <Help side={view.side} />
      {primary && <ActionDock>{primary}</ActionDock>}
    </Stack>
  );
}
