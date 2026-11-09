import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowRight, Armchair, BedDouble, CalendarClock, ChefHat, DoorClosed, Images, Inbox, MapPin, Package, Ruler, Store } from "lucide-react";
import type { ReactNode } from "react";
import { env } from "@/platform/env";
import { ru } from "@/i18n/ru";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  CategoryTiles,
  Container,
  DateText,
  DemoBanner,
  EmptyState,
  DealProgress,
  DetailColumns,
  FilterChips,
  FullscreenStep,
  MirrorPayout,
  RequestCard,
  SignedBadge,
  WorkCard,
  Input,
  KeyValueList,
  LinkList,
  Money,
  PageHeader,
  PhotoCard,
  RadioCards,
  SectionTitle,
  Select,
  Skeleton,
  Stat,
  StatTiles,
  StatusBadge,
  Stepper,
  StickyAction,
  Textarea,
  Timeline,
  TrustNote,
  type ChatMessage,
  type Tone,
} from "@/ui";
import { ChatDemo, LoadingButtonDemo, ModalDemo, PhotoDemo, StepperDemo } from "./KitDemos";

const k = ru.common.uiKit;
const s = k.sample;

export const metadata: Metadata = { title: k.title, robots: { index: false, follow: false } };

// Классы перечислены целиком, чтобы Tailwind их нашёл.
const SWATCHES = [
  ["canvas", "bg-canvas"],
  ["surface", "bg-surface"],
  ["sunken", "bg-sunken"],
  ["ink", "bg-ink"],
  ["ink-soft", "bg-ink-soft"],
  ["muted", "bg-muted"],
  ["line", "bg-line"],
  ["line-strong", "bg-line-strong"],
  ["primary", "bg-primary"],
  ["accent", "bg-accent"],
  ["accent-soft", "bg-accent-soft"],
  ["info", "bg-info"],
  ["info-soft", "bg-info-soft"],
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["warning-soft", "bg-warning-soft"],
  ["danger", "bg-danger"],
  ["danger-soft", "bg-danger-soft"],
] as const;

/** Плитки с картинками: иллюстрации из public/img (места под фото). */
const TILE_KEYS = ["kitchen", "wardrobe", "closet", "hallway"] as const;

const TONES: Tone[] = ["neutral", "accent", "info", "success", "warning", "danger"];

/** Витрина компонентов: только в разработке и в демо-режиме. */
export default async function UiKitPage() {
  await connection();
  const { DEMO_MODE, NODE_ENV } = env();
  if (!DEMO_MODE && NODE_ENV !== "development") notFound();

  const { sample, chat } = sampleData();

  return (
    <Container className="flex flex-col gap-12 pb-8">
      <PageHeader title={k.title} description={k.description} back={{ href: "/" }} />
      <Alert tone="accent">{k.tokensNote}</Alert>

      <KitSection title={k.sections.colors}>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SWATCHES.map(([name, bg]) => (
            <li key={name} className="flex flex-col gap-2">
              <span className={`h-16 rounded-card border border-line ${bg}`} />
              <code className="text-sm text-ink-soft">{name}</code>
            </li>
          ))}
        </ul>
      </KitSection>

      <KitSection title={k.sections.typography}>
        <div className="flex flex-col gap-3">
          <p className="text-3xl font-extrabold text-ink">{s.heading}</p>
          <p className="max-w-prose text-lg text-muted">{s.lead}</p>
          <p className="max-w-prose text-base text-ink">{s.body}</p>
          <p className="text-sm text-muted">{s.muted}</p>
        </div>
      </KitSection>

      <KitSection title={k.sections.buttons}>
        <div className="flex flex-wrap gap-3">
          <Button>{s.primary}</Button>
          <Button variant="secondary" icon={<ArrowLeft />}>
            {ru.common.actions.back}
          </Button>
          <Button iconEnd={<ArrowRight />}>{ru.common.actions.next}</Button>
          <Button variant="soft">{s.soft}</Button>
          <Button variant="ghost">{s.ghost}</Button>
          <Button variant="danger">{s.danger}</Button>
          <Button variant="dangerSolid">{s.danger}</Button>
          <Button variant="soft" shape="pill">
            {s.login}
          </Button>
        </div>
        <div className="flex flex-wrap gap-3">
          <LoadingButtonDemo />
          <Button variant="secondary" disabled>
            {s.disabled}
          </Button>
          <ButtonLink href="/ui-kit" variant="secondary">
            {s.ghost}
          </ButtonLink>
        </div>
        <Button fullWidth>{s.primary}</Button>
      </KitSection>

      <KitSection title={k.sections.fields}>
        <div className="flex max-w-form flex-col gap-6">
          <Input label={s.nameLabel} hint={s.nameHint} name="name" autoComplete="name" />
          <Input label={s.phoneLabel} name="phone" type="tel" inputMode="tel" defaultValue="+7 701" error={s.phoneError} />
          <Input label={s.phoneLabel} name="phone-disabled" disabled defaultValue="+7 701 000 00 00" />
          <Textarea label={s.commentLabel} hint={s.commentHint} name="comment" optional />
          <Select label={s.typeLabel} name="type" options={s.typeOptions.map((o) => ({ value: o, label: o }))} />
        </div>
      </KitSection>

      <KitSection title={k.sections.choice}>
        <div className="flex flex-col gap-6">
          <RadioCards label={s.materialLabel} name="material" options={s.materialOptions} defaultValue="mdf" columns={3} />
          <RadioCards
            label={s.tilesLabel}
            name="tiles"
            columns={3}
            defaultValue="kitchen"
            options={TILE_KEYS.map((key, i) => ({ value: key, label: s.tiles[i], image: { src: `/img/${key}.svg` } }))}
          />
          <RadioCards label={s.materialLabel} name="material-error" options={s.materialOptions} error={s.agreeError} />
          <Checkbox label={s.agree} name="agree" defaultChecked />
          <Checkbox label={s.agree} name="agree-error" error={s.agreeError} />
        </div>
      </KitSection>

      <KitSection title={k.sections.cards}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
          <Card
            title={s.cardTitle}
            titleAs="h3"
            description={s.cardText}
            footer={
              <>
                <Button>{s.primary}</Button>
                <Button variant="ghost">{s.ghost}</Button>
              </>
            }
          >
            <p className="text-2xl font-bold text-ink">
              <Money amount={1_250_000} />
            </p>
          </Card>
          <div className="flex flex-wrap content-start gap-2">
            {TONES.map((tone) => (
              <StatusBadge key={tone} tone={tone}>
                {s.badges[tone]}
              </StatusBadge>
            ))}
          </div>
        </div>
      </KitSection>

      <KitSection title={k.sections.photoCards}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
          <PhotoCard
            layout="row"
            href="/ui-kit"
            image={{ src: "/img/kitchen.svg" }}
            title={s.photoTitle}
            badge={<StatusBadge tone="info">{s.chips.comfort}</StatusBadge>}
            meta={[
              { icon: <MapPin />, text: s.photoCity },
              { icon: <CalendarClock />, text: s.photoDate },
            ]}
            aside={<Money amount={1_650_000} />}
          />
          <PhotoCard layout="row" title={s.photoNoImage} meta={[{ icon: <MapPin />, text: s.photoCity }]} badge={<StatusBadge tone="warning">{s.badges.warning}</StatusBadge>} />
        </div>
        <ul className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[repeat(2,minmax(0,1fr))] lg:grid-cols-[repeat(3,minmax(0,1fr))]">
          <PhotoCard
            as="li"
            image={{ src: "/img/closet.svg" }}
            title={s.photoTitle}
            meta={[{ text: s.photoSize }]}
            footer={<Button fullWidth>{s.offerAction}</Button>}
          />
          <PhotoCard as="li" href="/ui-kit" image={{ src: "/img/hallway.svg" }} title={s.photoNoImage} meta={[{ icon: <MapPin />, text: s.photoCity }]} />
          <PhotoCard as="li" title={s.photoNoImage} meta={[{ text: s.photoDate }]} />
        </ul>
      </KitSection>

      <KitSection title={k.sections.chips}>
        {/* Выбор живёт в адресе: чип — ссылка, активный — aria-current. Число — в подписи («Комфорт · 5»). */}
        <FilterChips
          label={s.chipsLabel}
          items={(
            [
              ["all", 12],
              ["economy", 4],
              ["comfort", 5],
              ["premium", 3],
            ] as const
          ).map(([key, n]) => ({ href: `/ui-kit?segment=${key}`, label: ru.common.ui.filterChip(s.chips[key], n), active: key === "comfort" }))}
        />
      </KitSection>

      <KitSection title={k.sections.lists}>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[repeat(2,minmax(0,1fr))]">
          <div className="flex flex-col gap-4">
            <SectionTitle title={s.sectionTitle} as="h3" action={{ href: "/ui-kit", label: s.seeAll }} />
            <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3">
              <li className="flex">
                <Stat className="flex-1" icon={<Inbox />} value={12} label={s.statRequests} />
              </li>
              <li className="flex">
                <Stat className="flex-1" icon={<Package />} value={5} label={s.statDeals} href="/ui-kit" />
              </li>
            </ul>
          </div>
          <LinkList
            items={[
              { href: "/ui-kit", label: s.listRequests, icon: <Inbox />, meta: 12, highlight: true },
              { href: "/ui-kit/#offers", label: s.listOffers, icon: <Ruler />, meta: 3 },
              { href: "/ui-kit/#portfolio", label: s.listPortfolio, icon: <Images />, meta: 24 },
              { href: "/ui-kit/#settings", label: s.listSettings, icon: <Store /> },
            ]}
          />
        </div>
      </KitSection>

      <KitSection title={k.sections.componentsA}>
        <div className="flex max-w-form flex-col gap-6">
          <CategoryTiles
            moreHref="/ui-kit"
            items={[ChefHat, DoorClosed, Armchair, BedDouble].map((icon, i) => ({ href: `/ui-kit#cat-${i}`, label: s.categories[i], icon }))}
          />
          <TrustNote>{s.trustNote}</TrustNote>
          <StatTiles
            items={[
              { label: s.statNew, value: "3", hint: s.statHint },
              { label: s.statWork, value: "5" },
            ]}
          />
          <KeyValueList rows={s.keyValueRows} />
          <FilterChips
            label={s.chipsLabel}
            items={[
              { href: "/ui-kit", label: s.chips.all, active: true },
              { href: "/ui-kit#comfort", label: s.chips.comfort, active: false },
              { href: "/ui-kit#premium", label: s.chips.premium, active: false },
            ]}
          />
        </div>
      </KitSection>

      <KitSection title={k.sections.componentsB}>
        <div className="flex flex-col gap-6">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(16rem,100%),1fr))] gap-4">
            <WorkCard href="/ui-kit#work" photoUrl="/img/kitchen.svg" title={s.workTitle} priceFrom={1_200_000} meta={s.workMeta} verified dealsCount={12} />
            <WorkCard photoUrl={null} priceFrom={null} meta={s.workMeta.slice(0, 2)} dealsCount={1} />
            <div className="flex flex-col gap-3">
              <RequestCard href="/ui-kit#req" thumbUrl="/img/wardrobe.svg" title={s.requestTitle} meta={s.requestMeta} isNew offersCount={5} />
              <RequestCard href="/ui-kit#req2" thumbUrl={null} title={s.requestTitle} meta={s.requestMeta} isNew={false} offersCount={0} />
            </div>
          </div>
          <div className="flex max-w-form flex-col gap-4">
            {(["CREATED", "IN_PROGRESS", "READY", "SPLIT_PAYOUT"] as const).map((status) => (
              <DealProgress key={status} status={status} hasOpenDispute={false} />
            ))}
            <DealProgress status="READY" hasOpenDispute />
            <DealProgress status="CANCELLED" hasOpenDispute={false} />
            <DealProgress status="REFUNDED" hasOpenDispute={false} />
            <MirrorPayout payoutTiyn={139_200_000n} guaranteeTiyn={5_800_000n} />
            <SignedBadge signedAt={new Date("2026-11-12T10:00:00Z")} documentNumber="2026-1147" />
          </div>
          <div className="max-w-form rounded-card border border-line bg-surface p-5">
            <FullscreenStep
              title={s.fullscreenTitle}
              back={{ href: "/ui-kit" }}
              action={
                <ButtonLink href="/ui-kit" fullWidth>
                  {s.fullscreenAction}
                </ButtonLink>
              }
              className="min-h-0"
            >
              <p className="text-base text-ink-soft">{s.fullscreenBody}</p>
            </FullscreenStep>
          </div>
        </div>
      </KitSection>

      <KitSection title={k.sections.detailColumns}>
        {/* Без action: главное действие витрины — один StickyAction в конце страницы. */}
        <DetailColumns
          lead={<DealProgress status="IN_PROGRESS" hasOpenDispute={false} />}
          aside={
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              <h3 className="text-lg font-bold text-ink">{s.detailAsideTitle}</h3>
              <KeyValueList rows={s.keyValueRows} />
              <TrustNote>{s.trustNote}</TrustNote>
            </div>
          }
          main={
            <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
              <h3 className="text-lg font-bold text-ink">{s.detailMainTitle}</h3>
              <p className="text-base text-ink-soft">{s.detailMain}</p>
              <p className="text-base text-muted">{s.detailLead}</p>
            </div>
          }
        />
      </KitSection>

      <KitSection title={k.sections.timeline}>
        <div className="max-w-form rounded-card border border-line bg-surface p-5">
          <Timeline
            label={s.timelineLabel}
            items={s.timeline.map((item, i) => ({ ...item, state: i < 2 ? "done" : i === 2 ? "current" : "todo" }))}
          />
        </div>
      </KitSection>

      <KitSection title={k.sections.alerts}>
        <div className="flex flex-col gap-3">
          <Alert tone="accent" title={s.alertAccentTitle}>
            {s.alertAccent}
          </Alert>
          <Alert tone="info">{s.alertInfo}</Alert>
          <Alert tone="success">{s.alertSuccess}</Alert>
          <Alert tone="warning" title={s.alertTitle}>
            {s.alertWarning}
          </Alert>
          <Alert tone="danger" action={<Button variant="secondary">{ru.common.actions.retry}</Button>}>
            {s.alertDanger}
          </Alert>
        </div>
        <DemoBanner />
      </KitSection>

      <KitSection title={k.sections.stepper}>
        <div className="max-w-form">
          <StepperDemo />
        </div>
        <div className="max-w-form">
          <Stepper steps={s.steps} current={4} back={{ href: "/ui-kit" }} />
        </div>
        <div className="max-w-form">
          <Stepper steps={s.steps.slice(1)} current={1} />
        </div>
      </KitSection>

      <KitSection title={k.sections.photos}>
        <div className="max-w-form">
          <PhotoDemo />
        </div>
      </KitSection>

      <KitSection title={k.sections.chat}>
        <div className="max-w-form">
          <ChatDemo initial={chat} />
        </div>
      </KitSection>

      <KitSection title={k.sections.modal}>
        <ModalDemo />
      </KitSection>

      <KitSection title={k.sections.formats}>
        <dl className="grid max-w-form grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">{s.money}</dt>
          <dd>
            <Money amount={1_250_000} />
          </dd>
          <dt className="text-muted">{s.date}</dt>
          <dd>
            <DateText value={sample} />
          </dd>
          <dt className="text-muted">{s.dateTime}</dt>
          <dd>
            <DateText value={sample} format="dateTime" />
          </dd>
          <dt className="text-muted">{s.relative}</dt>
          <dd>
            <DateText value={sample} format="relative" />
          </dd>
        </dl>
      </KitSection>

      <KitSection title={k.sections.empty}>
        <EmptyState icon={<Inbox />} title={s.emptyTitle} titleAs="h3" description={s.emptyText} action={<ButtonLink href="/ui-kit">{s.emptyAction}</ButtonLink>} />
        <div aria-busy="true" className="flex max-w-form flex-col gap-2">
          <span className="sr-only">{ru.common.loading}</span>
          <Skeleton lines={3} />
        </div>
      </KitSection>

      {/* Закреплённая кнопка экрана деталей: на телефоне над нижней панелью, на десктопе в потоке. Всегда последний в экране. */}
      <StickyAction>
        <Button fullWidth>{s.primary}</Button>
      </StickyAction>
    </Container>
  );
}

/** Примеры дат относительно момента запроса. */
function sampleData(): { sample: Date; chat: ChatMessage[] } {
  const now = Date.now();
  const ago = (minutes: number) => new Date(now - minutes * 60_000);
  return {
    sample: ago(180),
    chat: [
      { id: "1", kind: "system", text: s.chatSystem, sentAt: ago(26) },
      { id: "2", kind: "other", author: s.chatAuthor, text: s.chatTheirs, sentAt: ago(25) },
      { id: "3", kind: "own", text: s.chatMine, sentAt: ago(20) },
      { id: "4", kind: "other", author: s.chatAuthor, text: s.chatMasked, sentAt: ago(18), masked: true },
    ],
  };
}

function KitSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-5 border-t border-line pt-6">
      <h2 className="text-xl font-extrabold text-ink sm:text-2xl">{title}</h2>
      {children}
    </section>
  );
}
