import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Narrow, PageTitle, Stack } from "@/kit";
import { requireOperator } from "../../../../_shell/auth";
import { to } from "../../../../_shell/paths";
import { AddExecutorForm } from "./AddExecutorForm";

const f = ru.app.operatorQueues.executors.form;

export const metadata: Metadata = { title: f.metaTitle };

/** Добавить исполнителя вручную: форма не шире 560 px на компьютере, «Назад» — к списку исполнителей. */
export default async function NewExecutorPage() {
  await requireOperator(to("/operator/executors/new"));
  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={f.title} lead={f.lead} back={{ href: to("/operator/executors"), label: f.back }} />
        <AddExecutorForm />
      </Stack>
    </Narrow>
  );
}
