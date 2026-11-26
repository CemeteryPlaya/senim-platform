import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, EmptyState, List, ListRow, PageTitle, Section, Stack } from "@/kit";
import { kycQueueSize, listDisputes, listMoneyQueue, listRegistrationQueue, listStaleRequests } from "@/modules/operator";
import { requireOperator } from "../../_shell/auth";
import { to } from "../../_shell/paths";
import { operatorHome } from "./_parts/home";

const t = ru.app.operator.home;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * Главная оператора: первым — что требует внимания (строки-ссылки в очереди: операции банка, регистрации, открытые споры,
 * документы мастеров, заявки без откликов дольше суток); пустые очереди не показываются. Разделы — в меню (слева на
 * компьютере, «Меню» на телефоне). Главной кнопки нет: равноправные очереди, первая строка — самое срочное. «Назад» нет:
 * это дом роли. Число документов мастеров приходит из identity: не ответил — строка «нет связи», остальная главная работает.
 */
export default async function OperatorHome() {
  const user = await requireOperator(to("/operator"));
  const [money, registrations, kyc, disputes, stale] = await Promise.all([
    listMoneyQueue(user),
    listRegistrationQueue(user),
    kycQueueSize(user),
    listDisputes(user),
    listStaleRequests(user, { hours: 24 }),
  ]);
  const home = operatorHome({
    money: money.length,
    registrations: registrations.length,
    openDisputes: disputes.filter((dispute) => dispute.status === "OPEN").length,
    kyc,
    stale: stale.length,
  });

  return (
    <Stack gap="section">
      <PageTitle title={t.title} />
      <Section title={t.todo} id="todo">
        {home.todo.length === 0 ? (
          <EmptyState title={t.allClear} body={t.allClearHint} />
        ) : (
          <Card padded={false}>
            <List>
              {home.todo.map((item) => (
                <ListRow key={item.href} label={item.text} href={item.href} />
              ))}
            </List>
          </Card>
        )}
      </Section>
    </Stack>
  );
}
