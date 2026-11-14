import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Card, Narrow, PageTitle, Stack } from "@/kit";
import { getOwnPortfolioItem, listFurnitureTypes } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { REGISTER } from "../../_parts/approved";
import { readForOwner } from "../_parts/read";
import { PHOTOS_MAX } from "../_parts/work-schema";
import { initialValues } from "../_parts/work-view";
import { WorkActions } from "../_parts/WorkActions";
import { WorkForm } from "../_parts/WorkForm";

const t = ru.app.masterPortfolio.form;

export const metadata: Metadata = { title: t.editMeta };

type Props = { params: Promise<{ id: string }> };

/**
 * Правка работы: статус («Опубликована» / «Скрыта») с действиями (опубликовать или скрыть, удалить), затем форма с фото.
 * Чужая или удалённая работа — 404, как будто её нет (модуль отвечает NOT_FOUND). «Назад» — «Портфолио».
 */
export default async function EditWorkPage({ params }: Props) {
  const { id } = await params;
  const { user, status } = await requireMaster(to(`/executor/portfolio/${id}`));
  const device = await getDevice();
  const read = await readForOwner(status, async () => {
    try {
      return await Promise.all([getOwnPortfolioItem(user, id), listFurnitureTypes()]);
    } catch (e) {
      if (isAppError(e) && e.code === "NOT_FOUND") notFound();
      throw e;
    }
  });
  // Портфолио открыто и мастеру на проверке и после отказа; «нет профиля» — регистрация, как на остальных экранах мастера.
  if ("gate" in read) redirect(REGISTER);
  const [item, types] = read.data;

  const content = (
    <Stack>
      <Card>
        <WorkActions device={device} id={item.id} published={item.published} />
      </Card>
      <WorkForm
        device={device}
        types={types.map(({ id: typeId, name }) => ({ id: typeId, name }))}
        initial={initialValues(item)}
        itemId={item.id}
        photos={item.photos.flatMap((p) => (p.src ? [{ id: p.id, src: p.src }] : []))}
        maxPhotos={PHOTOS_MAX}
      />
    </Stack>
  );
  return (
    <Stack gap="section">
      <PageTitle title={t.editTitle} back={{ href: to("/executor/portfolio"), label: t.back }} />
      {device === "desktop" ? <Narrow>{content}</Narrow> : content}
    </Stack>
  );
}
