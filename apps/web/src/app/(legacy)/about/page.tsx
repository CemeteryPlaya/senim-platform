import type { Metadata } from "next";
import { EXECUTOR_REGISTRATION_PATH } from "@/modules/identity";
import { ru } from "@/i18n/ru";
import { ButtonLink, Container, PageHeader, TrustNote } from "@/ui";

const t = ru.landing.about;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Как работает Сенім» — то, что раньше было на лендинге (шаги и принцип денег): стартовый экран теперь только
 * фото и одно действие, а объяснение — здесь, по ссылке из подвала (для банка и тех, кто хочет разобраться).
 * Шаги — белая карточка с номерами, принцип денег — мятная плашка защиты (TrustNote), одна главная кнопка.
 */
export default function AboutPage() {
  return (
    <Container size="prose" className="pb-10">
      <PageHeader title={t.title} back={{ href: "/" }} />
      <div className="flex flex-col gap-6">
        <ol className="flex flex-col divide-y divide-line rounded-card border border-line bg-surface px-5 sm:px-6">
          {t.steps.map((step, i) => (
            <li key={step.title} className="flex gap-4 py-5">
              <span
                aria-hidden
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-lg font-extrabold text-primary tabular-nums"
              >
                {i + 1}
              </span>
              <div className="flex min-w-0 flex-col gap-1">
                <h2 className="text-lg font-bold text-ink">{step.title}</h2>
                <p className="text-base text-ink-soft">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>

        <section aria-labelledby="money">
          <TrustNote>
            <h2 id="money" className="text-lg font-bold text-ink">
              {t.money.title}
            </h2>
            <p className="mt-1 text-base text-ink">{t.money.text}</p>
          </TrustNote>
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
