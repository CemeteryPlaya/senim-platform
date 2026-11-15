import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Columns, Explain, List, ListRow, Money, Monogram, PageTitle, PhotoGallery, Section, Split, Stack, WorkCard } from "@/kit";
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

/**
 * Факты крупно под заголовком (разбор 4, п. 9): рейтинг, сделки в сервисе, стаж — три в одну строку без подложки.
 * Значение 22 px 600 в одну строку, подпись под ним серым. Нет данных — прочерк, а подпись говорит, чего нет
 * («Пока без отзывов», «Пока без сделок»): высота значений одинакова.
 */
function Facts({ view }: { view: ExecutorViewModel }) {
  const { rating } = view;
  const cells = [
    rating.value === null
      ? { label: ru.app.kit.rating.none, value: t.emptyValue }
      : { label: ru.app.guest.catalog.reviews(rating.count), value: rating.value.toFixed(1).replace(".", ",") },
    ...view.facts.map((fact) =>
      fact.plain ? { label: fact.value, value: t.emptyValue } : { label: fact.after ?? fact.before ?? t.dealsLabel, value: fact.value },
    ),
  ];
  return (
    <div role="group" aria-label={t.factsLabel} className="grid grid-cols-3 gap-4">
      {cells.map((cell) => (
        <dl key={cell.label} className="m-0 flex min-w-0 flex-col-reverse gap-1">
          <dt className="text-sub text-muted">{cell.label}</dt>
          <dd className="m-0 text-title-2 whitespace-nowrap text-ink tabular-nums">{cell.value}</dd>
        </dl>
      ))}
    </div>
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

/** «О мастере»: текст — обычным текстом (React экранирует), уже очищен модулем. */
function About({ view }: { view: ExecutorViewModel }) {
  return (
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
  );
}

/** Работы: мозаика снимков (галерея на весь экран по нажатию) и под ней компактные карточки с ценой «от». */
function Works({ view }: { view: ExecutorViewModel }) {
  return (
    <Section title={t.worksTitle}>
      {view.works.length === 0 ? (
        <p className="text-body text-muted">{t.worksEmpty}</p>
      ) : (
        <Stack>
          {view.gallery.length > 0 && <PhotoGallery photos={view.gallery} layout="mosaic" label={t.worksTitle} />}
          <Columns count={2}>
            {view.works.map((work) => (
              <WorkCard key={work.id} title={work.title} meta={work.meta} priceFrom={work.priceFrom} />
            ))}
          </Columns>
        </Stack>
      )}
    </Section>
  );
}

/** Отзывы заказчиков. */
function Reviews({ view }: { view: ExecutorViewModel }) {
  if (view.reviews.length === 0) return null;
  return (
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
  );
}

/**
 * Профиль мастера для заказчика: кому доверять (монограмма, крупные факты: рейтинг, сделки на платформе, стаж; мозаика работ с галереей на весь экран), условия
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
  const title = <PageTitle title={view.title} back={{ href: view.backHref, label: t.backLabel }} leading={<Monogram name={view.title} size="lg" />} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <Split
          stickyAside
          main={
            <Stack gap="section">
              <Facts view={view} />
              <Works view={view} />
              <About view={view} />
              <Reviews view={view} />
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
      <Facts view={view} />
      <Works view={view} />
      <About view={view} />
      <Conditions view={view} device={device} />
      <Reviews view={view} />
      <ActionDock>
        <ButtonLink href={view.action.href}>{view.action.label}</ButtonLink>
      </ActionDock>
    </Stack>
  );
}
