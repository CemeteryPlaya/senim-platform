import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ArrowLeft, ArrowRight, Inbox } from "lucide-react";
import type { ReactNode } from "react";
import { env } from "@/platform/env";
import { ru } from "@/i18n/ru";
import {
  Alert,
  Button,
  ButtonLink,
  Card,
  Checkbox,
  Container,
  DateText,
  DemoBanner,
  EmptyState,
  Input,
  Money,
  PageHeader,
  RadioCards,
  Select,
  SimulatorBadge,
  Skeleton,
  StatusBadge,
  Stepper,
  Textarea,
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
  ["success", "bg-success"],
  ["warning", "bg-warning"],
  ["danger", "bg-danger"],
] as const;

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
      <Alert tone="warning">{k.tokensNote}</Alert>

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
          <RadioCards label={s.materialLabel} name="material-error" options={s.materialOptions} error={s.agreeError} />
          <Checkbox label={s.agree} name="agree" defaultChecked />
          <Checkbox label={s.agree} name="agree-error" error={s.agreeError} />
        </div>
      </KitSection>

      <KitSection title={k.sections.cards}>
        <div className="grid gap-4 sm:grid-cols-2">
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
            <SimulatorBadge />
          </div>
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
      <h2 className="text-2xl font-extrabold text-ink">{title}</h2>
      {children}
    </section>
  );
}
