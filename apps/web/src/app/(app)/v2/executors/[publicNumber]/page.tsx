import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Explain, List, ListItem, ListRow, Money, PageTitle, Rating, Section, Split, Stack, WorkCard } from "@/kit";
import { getPublicExecutorPage } from "@/modules/companies";
import { getDevice, type Device } from "@/platform/device";
import { executorView, parsePublicNumber, type ExecutorViewModel, type SummaryRow } from "./_parts/executor-view";

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

/** Строка сводки: короткое значение — справа от подписи, длинное — под ней. */
function Row({ row }: { row: SummaryRow }) {
  if (row.kind === "rating") return <ListRow label={row.label} value={<Rating value={row.value} count={row.count} />} />;
  if (!row.stacked) return <ListRow label={row.label} value={row.value} />;
  return (
    <ListItem>
      <div className="flex flex-col gap-1 px-4 py-3">
        <p className="text-sub text-muted">{row.label}</p>
        <p className="text-body text-ink">
          {row.kind === "fee" && (
            <>
              <Money tiyn={row.feeTiyn} />{" "}
            </>
          )}
          {row.value}
        </p>
        {row.note && <p className="text-sub text-muted">{row.note}</p>}
      </div>
    </ListItem>
  );
}

function Summary({ view, device }: { view: ExecutorViewModel; device: Device }) {
  return (
    <Card padded={false}>
      <List>
        {view.rows.map((row) => (
          <Row key={row.label} row={row} />
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
    </Card>
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
          <ul className="grid grid-cols-1 gap-3 desktop:grid-cols-2 desktop:gap-4">
            {view.works.map((work) => (
              <li key={work.id} className="grid">
                <WorkCard href={work.href} title={work.title} meta={work.meta} priceFrom={work.priceFrom} photo={work.photo} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.reviewsTitle}>
        {view.reviews.length === 0 ? (
          <p className="text-body text-muted">{t.reviewsEmpty}</p>
        ) : (
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
        )}
      </Section>
    </>
  );
}

/**
 * Профиль мастера для заказчика: кому доверять (рейтинг, сделки на платформе, стаж, условия замера), о мастере, работы
 * и отзывы. Открыт гостю. Мастер показан ровно так, как его отдаёт модуль (`toPublicView`): по умолчанию «Исполнитель №N»,
 * без телефона, Instagram и ИИН/БИН; тексты уже очищены от контактов. Телефон — одна колонка: сводка, «О мастере», работы
 * и отзывы, главное действие в `ActionDock`. Компьютер — `Split`: слева «О мастере», работы и отзывы, справа прилипающая
 * сводка и главное действие. Мастер без работ получает не заявку, а только сведения: заявка строится по его работе.
 */
export default async function ExecutorPage({ params }: Props) {
  const page = await loadPage((await params).publicNumber);
  if (!page) notFound();
  const device = await getDevice();
  const view = executorView(page);
  const title = <PageTitle title={view.title} back={{ href: view.backHref, label: t.backLabel }} />;

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
          aside={
            <Stack>
              <Summary view={view} device={device} />
              {view.action && (
                <Card>
                  <ButtonLink href={view.action.href} full>
                    {view.action.label}
                  </ButtonLink>
                </Card>
              )}
            </Stack>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Summary view={view} device={device} />
      <Sections view={view} />
      {view.action && (
        <ActionDock>
          <ButtonLink href={view.action.href}>{view.action.label}</ButtonLink>
        </ActionDock>
      )}
    </Stack>
  );
}
