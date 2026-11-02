import Link from "next/link";
import { ArrowRight, BadgeCheck, HandCoins, ListChecks, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, SectionTitle } from "@/ui";
import { InstallBanner } from "../_components/install";
import { LOGIN_HREF } from "../_shell/nav";
import { illustration } from "./illustration";

const t = ru.landing;

// Маршруты фазы B: мастер заявки — marketplace-engineer, регистрация — identity-engineer, лента — companies.
const NEW_REQUEST_HREF = "/requests/new";
const REGISTER_HREF = "/register";
const INSPIRATION_HREF = "/inspiration";

/**
 * Лендинг для гостя по макетам 719 (структура) и 7–19 (стиль): заголовок с зелёным акцентом, три преимущества
 * и две карточки ролей — на первом экране; дальше — как это работает, примеры работ, деньги напрямую мастеру.
 * Картинки — иллюстрации из public/img: места под фото основателей (docs/design/README.md).
 */
export function Landing() {
  return (
    <>
      <section className="pt-6 pb-10 sm:pt-12 sm:pb-14">
        <Container className="@container grid grid-cols-[minmax(0,1fr)] gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:items-center lg:gap-12">
          <div className="flex min-w-0 flex-col gap-6">
            <div className="flex flex-col gap-4">
              <h1 className="text-display font-extrabold text-ink">
                {t.title} <span className="text-primary">{t.titleAccent}</span>
              </h1>
              <p className="max-w-prose text-lg text-muted">{t.lead}</p>
            </div>
            {/* Три преимущества в ряд — только когда им хватает места при текущем размере шрифта. */}
            <ul aria-label={t.features.label} className="grid grid-cols-[minmax(0,1fr)] gap-3 @min-[30em]:max-w-2xl @min-[30em]:grid-cols-3">
              <Feature icon={<Wallet />}>{t.features.stages}</Feature>
              <Feature icon={<BadgeCheck />}>{t.features.verified}</Feature>
              <Feature icon={<ListChecks />}>{t.features.control}</Feature>
            </ul>
            <p className="hidden text-base text-muted lg:block">
              {t.haveAccount}{" "}
              <Link href={LOGIN_HREF} className="font-semibold text-primary underline underline-offset-4">
                {t.login}
              </Link>
            </p>
          </div>

          <div className="flex min-w-0 flex-col gap-4">
            <ul aria-label={t.roles.label} className="flex flex-col gap-4">
              <RoleCard
                image={illustration("kitchen")}
                title={t.roles.client.title}
                text={t.roles.client.text}
                action={
                  <ButtonLink href={NEW_REQUEST_HREF} iconEnd={<ArrowRight />} fullWidth>
                    {t.roles.client.action}
                  </ButtonLink>
                }
              />
              <RoleCard
                image={illustration("workshop")}
                title={t.roles.executor.title}
                text={t.roles.executor.text}
                action={
                  <ButtonLink href={REGISTER_HREF} variant="soft" iconEnd={<ArrowRight />} fullWidth>
                    {t.roles.executor.action}
                  </ButtonLink>
                }
              />
            </ul>
            <p className="text-base text-muted lg:hidden">
              {t.haveAccount}{" "}
              <Link href={LOGIN_HREF} className="font-semibold text-primary underline underline-offset-4">
                {t.login}
              </Link>
            </p>
            <InstallBanner />
          </div>
        </Container>
      </section>

      <section aria-labelledby="how" className="pb-12 sm:pb-16">
        <Container className="flex flex-col gap-6">
          <h2 id="how" className="text-2xl font-extrabold text-ink sm:text-3xl">
            {t.how.title}
          </h2>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-0 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6 lg:grid-cols-4 lg:gap-6">
            {t.how.steps.map((step, i) => (
              <Step key={step.title} n={i + 1} last={i === t.how.steps.length - 1} title={step.title} text={step.text} />
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="examples" className="pb-12 sm:pb-16">
        <Container className="flex flex-col gap-4">
          <SectionTitle
            id="examples"
            title={t.examples.title}
            action={{ href: INSPIRATION_HREF, label: t.examples.action, ariaLabel: t.examples.actionLabel }}
            className="[&_h2]:text-2xl [&_h2]:font-extrabold sm:[&_h2]:text-3xl"
          />
          <p className="max-w-prose text-base text-muted">{t.examples.text}</p>
          <ul className="grid grid-cols-[repeat(2,minmax(0,1fr))] gap-3 sm:gap-4 lg:grid-cols-[repeat(4,minmax(0,1fr))]">
            {t.examples.items.map((item) => (
              <li key={item.key} className="flex min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface shadow-card">
                {/* Иллюстрация к подписи: для диктора её называет подпись. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={illustration(item.key)} alt="" loading="lazy" className="aspect-[4/3] w-full bg-sunken object-cover" />
                <p className="px-4 py-3 text-base font-semibold text-ink">{item.label}</p>
              </li>
            ))}
          </ul>
        </Container>
      </section>

      <section aria-labelledby="money" className="pb-12 sm:pb-16">
        <Container>
          <div className="flex flex-col items-start gap-4 rounded-card bg-accent-soft p-6 sm:flex-row sm:p-8">
            <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-card bg-surface text-primary">
              <HandCoins className="size-7" />
            </span>
            <div className="flex flex-col items-start gap-3">
              <h2 id="money" className="text-2xl font-extrabold text-ink">
                {t.money.title}
              </h2>
              <p className="max-w-prose text-base text-ink-soft">{t.money.text}</p>
              <ButtonLink href={NEW_REQUEST_HREF} iconEnd={<ArrowRight />}>
                {t.money.action}
              </ButtonLink>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-3 @min-[30em]:flex-col @min-[30em]:gap-2 @min-[30em]:text-center">
      <span aria-hidden className="inline-flex size-14 shrink-0 items-center justify-center rounded-card bg-surface text-primary shadow-card [&_svg]:size-7">
        {icon}
      </span>
      <span className="text-sm leading-tight font-semibold text-ink">{children}</span>
    </li>
  );
}

/** Карточка роли: иллюстрация слева (на узкой карточке — скрыта), заголовок и текст, кнопка во всю ширину. */
function RoleCard({ image, title, text, action }: { image: string; title: string; text: string; action: ReactNode }) {
  return (
    <li className="@container flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-4 shadow-card sm:p-5">
      <div className="flex min-w-0 items-center gap-4">
        {/* Иллюстрация к заголовку роли — декоративная. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={image} alt="" className="aspect-[4/3] w-28 shrink-0 rounded-control bg-sunken object-cover @max-[20em]:hidden sm:w-36" />
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-xl font-extrabold text-ink sm:text-2xl">{title}</h2>
          <p className="text-base text-muted">{text}</p>
        </div>
      </div>
      {action}
    </li>
  );
}

/** Шаг «Как это работает»: номер в мятном круге и линия к следующему (вертикально на телефоне, в ряд на широком). */
function Step({ n, last, title, text }: { n: number; last: boolean; title: string; text: string }) {
  return (
    <li className="relative flex gap-4 pb-6 last:pb-0 lg:flex-col lg:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute top-12 bottom-0 left-6 border-l-2 border-accent-soft lg:top-6 lg:right-0 lg:bottom-auto lg:left-14 lg:border-t-2 lg:border-l-0"
        />
      )}
      <span
        aria-hidden
        className="relative z-10 inline-flex size-12 shrink-0 items-center justify-center rounded-full bg-primary text-xl font-extrabold text-on-primary tabular-nums"
      >
        {n}
      </span>
      <div className="flex min-w-0 flex-col gap-1 pt-2 lg:pt-0">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        <p className="text-base text-muted">{text}</p>
      </div>
    </li>
  );
}
