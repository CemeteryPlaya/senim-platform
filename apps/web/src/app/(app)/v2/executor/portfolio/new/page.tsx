import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ru } from "@/i18n/ru";
import { Narrow, PageTitle, Stack } from "@/kit";
import { listFurnitureTypes } from "@/modules/companies";
import { getDevice } from "@/platform/device";
import { requireMaster } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { REGISTER } from "../../_parts/approved";
import { readForOwner } from "../_parts/read";
import { PHOTOS_MAX } from "../_parts/work-schema";
import { EMPTY_VALUES } from "../_parts/work-view";
import { WorkForm } from "../_parts/WorkForm";

const t = ru.app.masterPortfolio.form;

export const metadata: Metadata = { title: t.newMeta };

/**
 * Новая работа: фото, тип, стиль, название, описание, место, цена «от». Фото прикрепляются к работе при создании.
 * «Назад» — «Портфолио». Нет профиля мастера — экран статуса; мастер на проверке может добавлять работы.
 */
export default async function NewWorkPage() {
  const { status } = await requireMaster(to("/executor/portfolio/new"));
  const device = await getDevice();
  const read = await readForOwner(status, () => listFurnitureTypes());
  // Портфолио открыто и мастеру на проверке и после отказа; «нет профиля» — регистрация, как на остальных экранах мастера.
  if ("gate" in read) redirect(REGISTER);
  const form = <WorkForm device={device} types={read.data.map(({ id, name }) => ({ id, name }))} initial={EMPTY_VALUES} photos={[]} maxPhotos={PHOTOS_MAX} />;
  return (
    <Stack gap="section">
      <PageTitle title={t.newTitle} back={{ href: to("/executor/portfolio"), label: t.back }} />
      {device === "desktop" ? <Narrow>{form}</Narrow> : form}
    </Stack>
  );
}
