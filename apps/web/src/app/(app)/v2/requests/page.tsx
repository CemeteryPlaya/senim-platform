import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Card, Chips, EmptyState, List, ListRow, PageTitle, Split, Stack, StatusChip, TextLink } from "@/kit";
import { listMyRequests, myOfferStates } from "@/modules/requests";
import { getDevice } from "@/platform/device";
import { pageHref, requireBuyer } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { offersByRequest } from "../_parts/request-state";
import { requestListView, type RequestListView } from "./_parts/list-view";
import { wizardHref } from "./new/steps";

const t = ru.app.requests.list;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Разделы и заявки (или пустой раздел со ссылкой на все). Строка — ссылка: название, что с заявкой, статус справа. */
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
        <Card padded={false}>
          <List>
              {view.cards.map((card) => (
                <ListRow
                  key={card.id}
                  href={card.href}
                  label={
                    // Статус под названием, а не справа: на телефоне справа он сжимал бы строку «что с заявкой».
                    <span className="flex flex-col items-start gap-1">
                      <span className="text-card wrap-break-word text-ink">{card.title}</span>
                      <StatusChip tone={card.tone}>{card.status}</StatusChip>
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
 * список слева, справа карточка с действием (не растянутая телефонная страница).
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
      <Stack gap="section">
        {title}
        <Split
          main={<Requests view={view} />}
          aside={
            <Card>
              <Stack>
                <h2 className="text-card text-ink">{t.asideTitle}</h2>
                <p className="text-body text-muted">{t.asideBody}</p>
                <ButtonLink href={create.href} full>
                  {create.label}
                </ButtonLink>
              </Stack>
            </Card>
          }
        />
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
