import Link from "next/link";
import { ArrowRight, BadgeCheck, ListChecks, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { ButtonLink, cn, Container } from "@/ui";
import { LOGIN_HREF } from "./_shell/nav";

const t = ru.landing;

// Маршруты фазы B: мастер заявки — marketplace-engineer, регистрация — identity-engineer.
const NEW_REQUEST_HREF = "/requests/new";
const REGISTER_HREF = "/register";

/**
 * Лендинг по макету 719: заголовок с зелёным акцентом, три преимущества, две карточки ролей.
 * INTEGRATOR: фото героя и карточек ролей из макета не переданы файлами — когда появятся
 * (public/landing/*.jpg), их место — верх карточек ролей и правая колонка героя.
 */
export default function HomePage() {
  return (
    <>
      <section className="pt-8 pb-10 sm:pt-14 sm:pb-16">
        <Container className="@container flex flex-col gap-8">
          <div className="flex max-w-3xl flex-col gap-4">
            <h1 className="text-display font-extrabold text-ink">
              {t.title} <span className="text-accent">{t.titleAccent}</span>
            </h1>
            <p className="max-w-prose text-lg text-muted">{t.lead}</p>
          </div>

          {/* Три преимущества в ряд — только когда им хватает места при текущем размере шрифта. */}
          <ul aria-label={t.features.label} className="grid grid-cols-[minmax(0,1fr)] gap-3 @min-[30em]:max-w-2xl @min-[30em]:grid-cols-3 @min-[30em]:gap-4">
            <Feature icon={<Wallet />}>{t.features.stages}</Feature>
            <Feature icon={<BadgeCheck />}>{t.features.verified}</Feature>
            <Feature icon={<ListChecks />}>{t.features.control}</Feature>
          </ul>

          <ul aria-label={t.roles.label} className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
            <RoleCard
              title={t.roles.client.title}
              text={t.roles.client.text}
              action={
                <ButtonLink href={NEW_REQUEST_HREF} iconEnd={<ArrowRight />} fullWidth>
                  {t.roles.client.action}
                </ButtonLink>
              }
            />
            <RoleCard
              title={t.roles.executor.title}
              text={t.roles.executor.text}
              action={
                <ButtonLink href={REGISTER_HREF} variant="soft" iconEnd={<ArrowRight />} fullWidth>
                  {t.roles.executor.action}
                </ButtonLink>
              }
            />
          </ul>

          <p className="text-base text-muted">
            {t.haveAccount}{" "}
            <Link href={LOGIN_HREF} className="font-semibold text-primary underline underline-offset-4">
              {t.login}
            </Link>
          </p>
        </Container>
      </section>

      <section aria-labelledby="how" className="pb-12 sm:pb-16">
        <Container className="flex flex-col gap-6">
          <h2 id="how" className="text-2xl font-extrabold text-ink sm:text-3xl">
            {t.how.title}
          </h2>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-0 lg:grid-cols-4 lg:gap-6">
            {t.how.steps.map((step, i) => (
              <Step key={step.title} n={i + 1} first={i === 0} last={i === t.how.steps.length - 1} title={step.title} text={step.text} />
            ))}
          </ol>
        </Container>
      </section>

      <section aria-labelledby="money" className="pb-12 sm:pb-16">
        <Container>
          <div className="flex flex-col items-start gap-4 rounded-card bg-accent-soft p-6 sm:p-8">
            <h2 id="money" className="text-2xl font-extrabold text-primary">
              {t.money.title}
            </h2>
            <p className="max-w-prose text-base text-ink">{t.money.text}</p>
            <ButtonLink href={NEW_REQUEST_HREF} iconEnd={<ArrowRight />}>
              {t.money.action}
            </ButtonLink>
          </div>
        </Container>
      </section>
    </>
  );
}

function Feature({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex min-w-0 items-center gap-3 @min-[30em]:flex-col @min-[30em]:gap-2 @min-[30em]:text-center">
      <span aria-hidden className="inline-flex size-14 items-center justify-center rounded-card bg-surface text-primary shadow-card [&_svg]:size-7">
        {icon}
      </span>
      <span className="text-sm leading-tight font-semibold text-ink">{children}</span>
    </li>
  );
}

function RoleCard({ title, text, action }: { title: string; text: string; action: ReactNode }) {
  return (
    <li className="flex min-w-0 flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card sm:p-6">
      <h2 className="text-2xl font-extrabold text-ink">{title}</h2>
      <p className="text-base text-muted">{text}</p>
      <div className="mt-auto">{action}</div>
    </li>
  );
}

/** Шаг «Как это работает»: номер в круге и линия к следующему (вертикально на телефоне, в ряд на широком). */
function Step({ n, first, last, title, text }: { n: number; first: boolean; last: boolean; title: string; text: string }) {
  return (
    <li className="relative flex gap-4 pb-6 lg:flex-col lg:pb-0">
      {!last && (
        <span
          aria-hidden
          className="absolute top-12 bottom-0 left-6 border-l-2 border-line lg:top-6 lg:right-0 lg:bottom-auto lg:left-14 lg:border-t-2 lg:border-l-0"
        />
      )}
      <span
        aria-hidden
        className={cn(
          "relative z-10 inline-flex size-12 shrink-0 items-center justify-center rounded-full text-xl font-extrabold tabular-nums",
          first ? "bg-primary text-on-primary" : "border-2 border-line-strong bg-surface text-ink",
        )}
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
