import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Container, PageHeader } from "@/ui";
import { requireOperatorPage } from "../../_lib/guard";
import { AddExecutorForm } from "./AddExecutorForm";

const f = ru.operator.executors.form;

export const metadata: Metadata = { title: f.title };

export default async function NewExecutorPage() {
  await requireOperatorPage();
  return (
    <Container size="form">
      <PageHeader title={f.title} description={f.description} back={{ href: "/operator/executors" }} />
      <AddExecutorForm />
    </Container>
  );
}
