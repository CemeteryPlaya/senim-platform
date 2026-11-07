import type { Metadata } from "next";
import { EXECUTOR_REGISTRATION_PATH } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, PageHeader } from "@/ui";

const t = ru.landing.about;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Как работает Сенім» — то, что раньше было на лендинге (шаги и принцип денег): стартовый экран теперь только
 * фото и одно действие, а объяснение — здесь, по ссылке из подвала (для банка и тех, кто хочет разобраться).
 */
export default function AboutPage() {
  return (
    <Container size="prose">
      <PageHeader title={t.title} back={{ href: "/" }} />
      <div className="flex flex-col gap-10">
        <ol className="flex flex-col divide-y divide-line border-y border-line">
          {t.steps.map((step, i) => (
            <li key={step.title} className="flex gap-4 py-5">
              <span aria-hidden className="w-8 shrink-0 text-2xl leading-tight font-extrabold text-primary tabular-nums">
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-lg font-bold text-ink">{step.title}</h2>
                <p className="text-base text-muted">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <section aria-labelledby="money" className="flex flex-col gap-2">
          <h2 id="money" className="text-xl font-bold text-ink">
            {t.money.title}
          </h2>
          <p className="text-base text-ink-soft">{t.money.text}</p>
        </section>

        <div className="flex flex-col gap-3 sm:flex-row">
          <ButtonLink href="/requests/new">{t.clientAction}</ButtonLink>
          <ButtonLink href={EXECUTOR_REGISTRATION_PATH} variant="secondary">
            {t.executorAction}
          </ButtonLink>
        </div>
      </div>
    </Container>
  );
}
