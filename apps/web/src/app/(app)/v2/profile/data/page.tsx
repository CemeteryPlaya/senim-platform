import type { Metadata } from "next";
import { ru } from "@/i18n/ru";
import { Card, List, ListRow, Narrow, Notice, PageTitle, Section, Stack, StatusChip, TextLink } from "@/kit";
import { dealRefsOf } from "@/modules/deal-core";
import { getMyData } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { requireV2User } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { ConsentActions } from "./ConsentActions";
import { dataView } from "./data-view";

const t = ru.app.profile.data;

export const metadata: Metadata = { title: t.metaTitle };

/**
 * «Мои данные»: ФИО, ИИН только последними четырьмя цифрами, телефон, почта, Instagram; действующие согласия с редакцией и
 * датой; заявка на отзыв согласия (статус и срок). Отзыв — тихое действие в меню, с подтверждением. Полного ИИН на экране
 * нет: модуль отдаёт только последние четыре цифры.
 */
export default async function MyDataPage() {
  const user = await requireV2User(to("/profile/data"), "CLIENT", "EXECUTOR");
  const data = await getMyData(user);
  const deals = await dealRefsOf(user, data.consents.flatMap((c) => (c.dealId ? [c.dealId] : [])));
  const view = dataView(data, deals);
  const device = await getDevice();
  const rev = view.revocation;

  return (
    <Narrow>
      <Stack gap="section">
        <PageTitle title={t.title} back={{ href: to("/profile"), label: t.back }} lead={t.lead} />
        <Section title={t.personTitle}>
          <Card padded={false}>
            <List>
              {view.person.map((row) => (
                <ListRow key={row.label} label={row.label} value={row.value} stacked={row.stacked} />
              ))}
            </List>
          </Card>
        </Section>
        <section aria-labelledby="my-data-consents" className="flex min-w-0 flex-col gap-stack-group">
          <div className="flex items-center justify-between gap-2">
            <h2 id="my-data-consents" className="text-title-2 text-ink">
              {t.consentsTitle}
            </h2>
            {view.canRevoke && <ConsentActions device={device} bankDeals={view.bankDeals} />}
          </div>
          {view.consents.length === 0 ? (
            <Card>
              <p className="text-body text-ink">{t.noConsents}</p>
            </Card>
          ) : (
            view.consents.map((c) => (
              <Card key={c.id} as="article">
                <p className="text-headline text-ink">{c.title}</p>
                <p className="mt-1 text-body text-muted">{c.edition}</p>
                <p className="text-body text-muted">
                  {t.granted}: {c.granted}
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <StatusChip tone="accent">{t.statusActive}</StatusChip>
                  {c.deal && <TextLink href={c.deal.href}>{c.deal.label}</TextLink>}
                </div>
              </Card>
            ))
          )}
        </section>
        {rev && (
          <Section title={t.revocation.title}>
            <Card padded={false}>
              <div className="p-4 pb-1">
                <StatusChip tone={rev.status === "REFUSED" ? "danger" : rev.status === "REQUESTED" ? "warn" : "neutral"}>{rev.statusText}</StatusChip>
              </div>
              <List>
                {rev.rows.map((row) => (
                  <ListRow key={row.label} label={row.label} value={row.value} stacked />
                ))}
              </List>
            </Card>
            {rev.open && <Notice tone="info">{t.revocation.stillActive}</Notice>}
          </Section>
        )}
      </Stack>
    </Narrow>
  );
}
