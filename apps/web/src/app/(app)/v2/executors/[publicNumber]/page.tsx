import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Columns, Explain, List, ListRow, Money, PageTitle, Rating, Section, Split, Stack, WorkCard } from "@/kit";
import { getPublicExecutorPage } from "@/modules/companies";
import { getDevice, type Device } from "@/platform/device";
import { userPastOnboarding } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { executorView, parsePublicNumber, type ExecutorViewModel } from "./_parts/executor-view";

const t = ru.app.guest.executor;

type Props = { params: Promise<{ publicNumber: string }> };

/** Один запрос к БД на HTTP-запрос: и метаданные, и страница. Не число в адресе — страницы нет, базу не трогаем. */
const loadPage = cache(async (raw: string) => {
  const publicNumber = parsePublicNumber(raw);
  return publicNumber === null ? null : getPublicExecutorPage(publicNumber);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPage((await params).publicNumber);
  return { title: page ? page.view.label : ru.app.shell.notFoundTitle };
}

/** Строка-сводка под заголовком: рейтинг · сделки в сервисе · стаж. Значения тёмные, пояснения серые. */
function FactsLine({ view }: { view: ExecutorViewModel }) {
  return (
    <p className="text-body text-muted">
      <Rating value={view.rating.value} count={view.rating.count} />
      {view.facts.map((fact) => (
        <span key={fact.value}>
          {" · "}
          {fact.before && `${fact.before} `}
          {fact.plain ? fact.value : <span className="text-ink">{fact.value}</span>}
          {fact.after && ` ${fact.after}`}
        </span>
      ))}
    </p>
  );
}

/** Карточка «Условия»: строки, ссылка-пояснение и (на компьютере) главная кнопка последней в карточке. */
function Conditions({ view, device }: { view: ExecutorViewModel; device: Device }) {
  return (
    <Section title={t.conditionsTitle}>
      <Card padded={false}>
        <List>
          {view.conditions.map((row) => (
            <ListRow
              key={row.label}
              label={row.label}
              stacked={row.layout === "stacked"}
              value={
                <>
                  {row.feeTiyn !== undefined && (
                    <>
                      <Money tiyn={row.feeTiyn} />{" "}
                    </>
                  )}
                  {row.value}
                  {row.note && <span className="mt-1 block text-sub text-muted">{row.note}</span>}
                </>
              }
            />
          ))}
        </List>
        <div className="border-t border-line px-4 py-3">
          <Explain label={view.explain.label} title={view.explain.title} device={device}>
            <Stack>
              {view.explain.paragraphs.map((text) => (
                <p key={text} className="text-body text-ink">
                  {text}
                </p>
              ))}
            </Stack>
          </Explain>
        </div>
        {device === "desktop" && (
          <div className="px-4 pb-4">
            <ButtonLink href={view.action.href} full>
              {view.action.label}
            </ButtonLink>
          </div>
        )}
      </Card>
    </Section>
  );
}

/** «О мастере», работы и отзывы: тексты — обычным текстом (React экранирует), уже очищены модулем. */
function Sections({ view }: { view: ExecutorViewModel }) {
  return (
    <>
      <Section title={t.aboutTitle}>
        <Card>
          {view.about.length === 0 ? (
            <p className="text-body text-muted">{t.aboutEmpty}</p>
          ) : (
            <Stack>
              {view.about.map((text, i) => (
                <p key={i} className="text-body text-ink">
                  {text}
                </p>
              ))}
            </Stack>
          )}
        </Card>
      </Section>
      <Section title={t.worksTitle}>
        {view.works.length === 0 ? (
          <p className="text-body text-muted">{t.worksEmpty}</p>
        ) : (
          <Columns count={2}>
            {view.works.map((work) => (
              <WorkCard key={work.id} title={work.title} meta={work.meta} priceFrom={work.priceFrom} media={view.worksMedia} photo={work.photo} />
            ))}
          </Columns>
        )}
      </Section>
      {view.reviews.length > 0 && (
        <Section title={t.reviewsTitle}>
          <ul className="flex flex-col gap-3">
            {view.reviews.map((review) => (
              <li key={review.id} id={`review-${review.id}`} className="scroll-anchor">
                <Card as="article">
                  <p className="text-sub text-muted">
                    <span className="text-ink">{review.ratingLabel}</span> · {review.date}
                  </p>
                  {review.text && <p className="mt-1 whitespace-pre-line text-body text-ink">{review.text}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/**
 * Профиль мастера для заказчика: кому доверять (строка под заголовком: рейтинг, сделки на платформе, стаж), условия
 * (специализация, замер, где работает), о мастере, работы и отзывы. Открыт гостю. Мастер показан ровно так, как его отдаёт
 * модуль (`toPublicView`): по умолчанию «Исполнитель №N», без телефона, Instagram и ИИН/БИН; тексты уже очищены от
 * контактов и наименования. Телефон — одна колонка и `ActionDock` в конце. Компьютер — `Split`: слева «О мастере», работы и
 * отзывы, справа прилипающая карточка условий, внизу которой главная кнопка. Действие есть у любого мастера: заявка
 * с параметром `executor` (публичный номер) — контракт для экрана заявки следующего этапа. Карточки работ неинтерактивны.
 */
export default async function ExecutorPage({ params }: Props) {
  const { publicNumber } = await params;
  // Вошедший с непройденными первыми шагами — на шаг с возвратом сюда (адрес проверит safeNext).
  await userPastOnboarding(to(`/executors/${encodeURIComponent(publicNumber)}`));
  const page = await loadPage(publicNumber);
  if (!page) notFound();
  const device = await getDevice();
  const view = executorView(page);
  const title = <PageTitle title={view.title} back={{ href: view.backHref, label: t.backLabel }} lead={<FactsLine view={view} />} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          stickyAside
          main={
            <Stack gap="section">
              <Sections view={view} />
            </Stack>
          }
          aside={<Conditions view={view} device={device} />}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Conditions view={view} device={device} />
      <Sections view={view} />
      <ActionDock>
        <ButtonLink href={view.action.href}>{view.action.label}</ButtonLink>
      </ActionDock>
    </Stack>
  );
}
