import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Chips, EmptyState, List, ListRow, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listMyRequests, myOfferStates } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { pageHref, requireBuyer } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { offersByRequest } from "../../_parts/request-state";
import { thumbOf } from "../../_parts/Thumb";
import { requestListView, type RequestListView } from "../_parts/list-view";
import { wizardHref } from "../new/steps";

const t = ru.app.requests.list;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Разделы и заявки (или пустой раздел со ссылкой на все). Строка — ссылка (сгруппированный список): миниатюра 56 px
 * (первое фото помещения), название, короткая плашка и число предложений, что с заявкой и короткая дата.
 */
function Requests({ view }: { view: RequestListView }) {
  return (
    <Stack>
      {view.chips.length > 0 && <Chips label={t.filterLabel} items={view.chips} />}
      {view.empty === "filter" ? (
        <Stack gap="tight">
          <EmptyState title={t.filterEmptyTitle} body={t.filterEmptyBody} />
          <TextLink href={to("/requests")}>{t.showAll}</TextLink>
        </Stack>
      ) : (
        <Card variant="grouped">
          <List>
            {view.cards.map((card) => (
              <ListRow
                key={card.id}
                href={card.href}
                leading={thumbOf(card.cover)}
                label={
                  // Статус под названием, а не справа: на телефоне справа он сжимал бы строку «что с заявкой».
                  <span className="flex flex-col items-start gap-1 py-1">
                    <span className="text-headline wrap-break-word text-ink">{card.title}</span>
                    {(card.chip || card.note) && (
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {card.chip && <StatusChip tone={card.tone}>{card.chip}</StatusChip>}
                        {card.note && <span className="text-sub text-muted">{card.note}</span>}
                      </span>
                    )}
                    <span className="text-sub text-muted">{card.meta}</span>
                  </span>
                }
              />
            ))}
          </List>
        </Card>
      )}
    </Stack>
  );
}

/**
 * «Мои заявки» покупателя: разделы чипами (группы статусов), строки-ссылки (название или «Черновик», что с заявкой — шаг
 * черновика или число предложений и дата, статус). Черновик ведёт в мастер на свой шаг, отправленная — на карточку заявки.
 * Пусто — обучающий экран с единственным действием «Заказать мебель». Телефон: одна колонка, действие в доке. Компьютер:
 * одна колонка 760 px по центру, только список: «Заказать мебель» и так стоит в шапке каждого экрана, отдельная карточка
 * над списком его повторяла бы и отодвигала заявки.
 */
export default async function MyRequestsPage({ searchParams }: Props) {
  const params = await searchParams;
  const user = await requireBuyer(pageHref("/requests", params));
  const status = typeof params.status === "string" ? params.status : undefined;
  const [list, offers] = await Promise.all([listMyRequests(user), myOfferStates(user)]);
  const view = requestListView(list, status, offersByRequest(offers));
  const device = await getDevice();
  const create = { href: wizardHref(), label: t.create };
  const title = <PageTitle title={t.title} />;

  if (view.empty === "none") {
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.emptyTitle} body={t.emptyBody} action={create} />
      </Stack>
    );
  }

  if (device === "desktop") {
    return (
      <Stack gap="section" className="desktop:mx-auto desktop:w-full desktop:max-w-home">
        {title}
        <Requests view={view} />
      </Stack>
    );
  }

  return (
    <Stack gap="section">
      {title}
      <Requests view={view} />
      <ActionDock>
        <ButtonLink href={create.href}>{create.label}</ButtonLink>
      </ActionDock>
    </Stack>
  );
}
