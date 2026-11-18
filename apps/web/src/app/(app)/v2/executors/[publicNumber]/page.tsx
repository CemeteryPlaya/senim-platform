import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ru } from "@/i18n/ru";
import {
  ActionDock,
  ButtonLink,
  Card,
  Columns,
  Explain,
  List,
  ListRow,
  Money,
  Monogram,
  PageTitle,
  PhotoGallery,
  Section,
  Split,
  Stack,
  Stat,
  StatRow,
  StatusChip,
  WorkCard,
} from "@/kit";
import { getDevice, type Device } from "@/platform/device";
import { pageHref, userPastOnboarding } from "../../../_shell/auth";
import { cardsMedia } from "../../_parts/work-card";
import { parseExecutorsSearch } from "../_parts/list-view";
import { executorView, parsePublicNumber, type DealView, type ExecutorViewModel } from "./_parts/executor-view";
import { InviteControl } from "./_parts/InviteControl";
import type { InviteView } from "./_parts/invite";
import { loadExecutorPageData } from "./_parts/load";
import { loadInvite } from "./_parts/load-invite";

const t = ru.app.guest.executor;

/** Карточка в сетке из двух колонок основной части профиля. */
const HALF_SIZES = "(min-width: 64rem) 360px, 100vw";

type Props = { params: Promise<{ publicNumber: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Одна загрузка на HTTP-запрос: и метаданные, и страница. Не число в адресе — страницы нет, базу не трогаем. */
const loadPage = cache(async (raw: string) => {
  const publicNumber = parsePublicNumber(raw);
  return publicNumber === null ? null : loadExecutorPageData(publicNumber);
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = await loadPage((await params).publicNumber);
  return { title: page ? page.view.label : ru.app.shell.notFoundTitle };
}

/**
 * Числа под заголовком (спека 2026-11-17, 3.3): рейтинг с числом отзывов, «Сделок», «Успешных N%» — в одну строку
 * (`StatRow inline`). Нет данных — прочерк приглушённо, а подпись говорит, чего нет («Пока без отзывов», «Пока нет
 * завершённых сделок»).
 */
function Facts({ view }: { view: ExecutorViewModel }) {
  return (
    <StatRow label={t.factsLabel} inline>
      {view.stats.map((stat) => (
        <Stat key={stat.label} label={stat.label} value={stat.value} compact muted={stat.muted} />
      ))}
    </StatRow>
  );
}

/** Карточка «Условия»: строки, ссылка-пояснение и (на компьютере) главная кнопка последней в карточке. */
/**
 * Главное действие экрана. Есть приглашение (кнопка) — оно главное, а «Предложить заказ» становится тихой ссылкой рядом;
 * иначе «Предложить заказ» — главное. Одна главная кнопка на экране в любом случае.
 */
function PrimaryActions({ view, invite, device, publicNumber }: { view: ExecutorViewModel; invite: InviteView; device: Device; publicNumber: number }) {
  const withInvite = invite.kind === "context" || invite.kind === "pick";
  return (
    <>
      {withInvite && <InviteControl view={invite} publicNumber={publicNumber} device={device} />}
      <ButtonLink href={view.action.href} {...(withInvite ? { variant: "quiet" as const } : {})}>
        {view.action.label}
      </ButtonLink>
    </>
  );
}

/** Состояние приглашения без кнопки («Приглашение отправлено», «Работает в другой ценовой группе»). */
function InviteNote({ invite }: { invite: InviteView }) {
  if (invite.kind !== "note") return null;
  return <p className="text-body text-muted">{invite.text}</p>;
}

function Conditions({ view, device, invite, publicNumber }: { view: ExecutorViewModel; device: Device; invite: InviteView; publicNumber: number }) {
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
          <div className="flex flex-col gap-2 px-4 pb-4 *:w-full">
            <PrimaryActions view={view} invite={invite} device={device} publicNumber={publicNumber} />
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

/** «Лучшие работы»: витрина, которую собрал мастер (сделки и работы вне площадки), в его порядке. Пусто — раздела нет. */
function Highlights({ view }: { view: ExecutorViewModel }) {
  if (view.highlights.length === 0) return null;
  const media = cardsMedia(view.highlights);
  return (
    <Section title={t.highlightsTitle}>
      <Columns count={2}>
        {view.highlights.map((card) => (
          <WorkCard key={card.id} title={card.title} meta={card.meta} media={media} sizes={HALF_SIZES} {...(card.photo ? { photo: card.photo } : {})} />
        ))}
      </Columns>
    </Section>
  );
}

/**
 * Карточка сделки: фото сдачи лентой, что делали, уровень и месяц, итог; стоимость и место — только если покупатель
 * разрешил; отзыв покупателя — внизу карточки, с подписью, как он выбрал.
 */
function DealCard({ deal }: { deal: DealView }) {
  return (
    <Card as="article">
      <Stack>
        {deal.photos.length > 0 && <PhotoGallery photos={deal.photos} layout="strip" label={t.dealPhotos(deal.title)} />}
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-headline text-ink">{deal.title}</h3>
            <p className="text-sub text-muted">{deal.meta}</p>
          </div>
          <StatusChip tone={deal.outcome.tone}>{deal.outcome.label}</StatusChip>
        </div>
        {(deal.priceTiyn !== undefined || deal.place !== undefined) && (
          <dl className="m-0 flex flex-col gap-1 text-body">
            {deal.priceTiyn !== undefined && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{t.dealPrice}</dt>
                <dd className="m-0">
                  <Money tiyn={deal.priceTiyn} />
                </dd>
              </div>
            )}
            {deal.place !== undefined && (
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-muted">{t.dealPlace}</dt>
                <dd className="m-0 text-ink">{deal.place}</dd>
              </div>
            )}
          </dl>
        )}
        {deal.review && (
          <figure className="m-0 border-t border-line pt-3">
            <p className="text-sub text-ink">{deal.review.ratingLabel}</p>
            {deal.review.text && <blockquote className="m-0 mt-1 whitespace-pre-line text-body text-ink">{deal.review.text}</blockquote>}
            {deal.review.signature && <figcaption className="mt-1 text-sub text-muted">{deal.review.signature}</figcaption>}
          </figure>
        )}
      </Stack>
    </Card>
  );
}

/** «Сделки на площадке»: оконченные сделки, новые выше; отзыв — внизу своей сделки. Пусто — текст. */
function Deals({ view }: { view: ExecutorViewModel }) {
  return (
    <Section title={t.dealsTitle}>
      {view.deals.length === 0 ? (
        <p className="text-body text-muted">{t.dealsEmpty}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {view.deals.map((deal) => (
            <li key={deal.id} id={`deal-${deal.id}`} className="scroll-anchor">
              <DealCard deal={deal} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** «Работы вне площадки»: мозаика снимков (галерея на весь экран) и компактные карточки с пометкой. Пусто — раздела нет. */
function OffPlatform({ view }: { view: ExecutorViewModel }) {
  const { works, gallery } = view.offPlatform;
  if (works.length === 0) return null;
  return (
    <Section title={t.offPlatformTitle}>
      <Stack>
        {gallery.length > 0 && <PhotoGallery photos={gallery} layout="mosaic" label={t.offPlatformTitle} />}
        <Columns count={2}>
          {works.map((work) => (
            <WorkCard key={work.id} title={work.title} meta={work.meta} byline={work.byline} priceFrom={work.priceFrom} />
          ))}
        </Columns>
      </Stack>
    </Section>
  );
}

/**
 * Профиль мастера для заказчика (спека 2026-11-17, 3.3): монограмма и числа (рейтинг, отзывы, сделки, доля успешных),
 * «Лучшие работы», «Сделки на площадке» с отзывом под каждой, «Работы вне площадки», «О мастере», условия. Отдельного
 * раздела отзывов нет. Открыт гостю. Мастер показан ровно так, как его отдаёт модуль (`toPublicView`, ADR-006): по
 * умолчанию «Исполнитель №N», без телефона, Instagram и ИИН/БИН; тексты уже очищены; фото, стоимость, место и подпись
 * сделки — только по выбору покупателя. Телефон — одна колонка и `ActionDock` в конце. Компьютер — `Split`: слева разделы,
 * справа прилипающая карточка условий с главной кнопкой. Действие есть у любого мастера: заявка с параметром `executor`
 * (публичный номер). Карточки работ и сделок неинтерактивны.
 */
export default async function ExecutorPage({ params, searchParams }: Props) {
  const { publicNumber } = await params;
  const search = await searchParams;
  // Вошедший с непройденными первыми шагами — на шаг с возвратом сюда (адрес проверит safeNext).
  const user = await userPastOnboarding(pageHref(`/executors/${encodeURIComponent(publicNumber)}`, search));
  const page = await loadPage(publicNumber);
  if (!page) notFound();
  const device = await getDevice();
  const { requestId } = parseExecutorsSearch(search);
  const view = executorView(page, { requestId });
  const invite = await loadInvite(user, { publicNumber: page.view.publicNumber, segment: page.view.segment }, requestId);
  const title = <PageTitle title={view.title} back={{ href: view.backHref, label: t.backLabel }} leading={<Monogram name={view.title} size="lg" />} />;

  if (device === "desktop") {
    return (
      <Stack gap="section">
        {title}
        <InviteNote invite={invite} />
        <Split
          stickyAside
          main={
            <Stack gap="section">
              <Facts view={view} />
              <Highlights view={view} />
              <Deals view={view} />
              <OffPlatform view={view} />
              <About view={view} />
            </Stack>
          }
          aside={<Conditions view={view} device={device} invite={invite} publicNumber={page.view.publicNumber} />}
        />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <InviteNote invite={invite} />
      <Facts view={view} />
      <Highlights view={view} />
      <Deals view={view} />
      <OffPlatform view={view} />
      <About view={view} />
      <Conditions view={view} device={device} invite={invite} publicNumber={page.view.publicNumber} />
      <ActionDock>
        <PrimaryActions view={view} invite={invite} device={device} publicNumber={page.view.publicNumber} />
      </ActionDock>
    </Stack>
  );
}
