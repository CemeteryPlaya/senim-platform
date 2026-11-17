import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Columns, EmptyState, List, ListRow, PageTitle, Stack, Card } from "@/kit";
import { HIGHLIGHTS_MAX, listHighlightCandidates, listOwnPortfolio } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { requireMaster } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { REGISTER } from "../_parts/approved";
import { readForOwner } from "./_parts/read";
import { workListView } from "./_parts/work-view";
import { WorkTile } from "./_parts/WorkTile";

const t = ru.app.masterPortfolio.list;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Портфолио мастера: его работы карточками (фото, название, статус «Опубликована» / «Скрыта» чипом, тип, стиль и число фото, цена «от»); карточка
 * ведёт в правку, где публикация и удаление. «Добавить работу» — главное действие (док на телефоне, под заголовком на
 * компьютере); пусто — обучающий экран с тем же действием. Открыто и мастеру на проверке (портфолио заполняют до
 * проверки); нет профиля мастера — экран статуса. «Назад» — «Компания».
 */
export default async function PortfolioPage() {
  const { user, status } = await requireMaster(to("/executor/portfolio"));
  const device = await getDevice();
  const read = await readForOwner(status, () => listOwnPortfolio(user));
  // Портфолио открыто и мастеру на проверке и после отказа; «нет профиля» — регистрация, как на остальных экранах мастера.
  if ("gate" in read) redirect(REGISTER);

  const title = <PageTitle title={t.title} back={{ href: to("/executor/profile"), label: t.back }} />;
  if (read.data.length === 0) {
    return (
      <Stack gap="section">
        {title}
        <EmptyState title={t.empty.title} body={t.empty.body} action={{ href: to("/executor/portfolio/new"), label: t.add }} />
      </Stack>
    );
  }
  const view = workListView(read.data);
  // «Лучшие работы» выбирает одобренный мастер (так отвечает и модуль); на проверке ссылки нет.
  const best =
    status === "approved" ? (
      <Card padded={false}>
        <List>
          <ListRow label={t.best((await listHighlightCandidates(user)).items.filter((c) => c.selected).length, HIGHLIGHTS_MAX)} href={to("/executor/portfolio/best")} />
        </List>
      </Card>
    ) : null;
  const add = (
    <ActionDock>
      <ButtonLink href={to("/executor/portfolio/new")}>{t.add}</ButtonLink>
    </ActionDock>
  );
  const tiles = view.rows.map((row) => <WorkTile key={row.id} row={row} media={view.media} />);
  return (
    <Stack gap="section">
      {title}
      {device === "desktop" && add}
      {best}
      <Stack>
        <p className="text-sub text-muted">{view.countText}</p>
        {view.media === "slot" ? (
          // Сетка фото: две колонки на телефоне, три на компьютере.
          <div className="grid grid-cols-2 gap-3 *:min-w-0 desktop:grid-cols-3">{tiles}</div>
        ) : (
          <Columns count={3}>{tiles}</Columns>
        )}
      </Stack>
      {device === "mobile" && add}
    </Stack>
  );
}
