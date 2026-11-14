import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { ActionDock, ButtonLink, Columns, EmptyState, PageTitle, Stack } from "@/kit";
import { listOwnPortfolio } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { requireMaster } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { MasterGate } from "../_parts/MasterGate";
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
  if ("gate" in read) return <MasterGate status={read.gate} title={t.title} device={device} />;

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
  const add = (
    <ActionDock>
      <ButtonLink href={to("/executor/portfolio/new")}>{t.add}</ButtonLink>
    </ActionDock>
  );
  return (
    <Stack gap="section">
      {title}
      {device === "desktop" && add}
      <Stack>
        <p className="text-sub text-muted">{view.countText}</p>
        <Columns count={3}>
          {view.rows.map((row) => (
            <WorkTile key={row.id} row={row} media={view.media} />
          ))}
        </Columns>
      </Stack>
      {device === "mobile" && add}
    </Stack>
  );
}
