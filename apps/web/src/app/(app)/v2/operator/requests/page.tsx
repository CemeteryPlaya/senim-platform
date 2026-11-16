import type { Metadata } from "next";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { Chips, DataTable, Notice, PageTitle, Stack, StatusChip, TextLink } from "@/kit";
import { listStaleRequests, staleRequestsSchema } from "@/modules/operator";
import { isEnabled } from "@/platform/features";
import { requireOperator } from "../../../_shell/auth";
import { legacy, to } from "../../../_shell/paths";
import { filterChips } from "../_parts/filters";
import { hoursOptions } from "./hours";

const t = ru.app.operatorDisputes.requests;

export const metadata: Metadata = { title: t.metaTitle };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/**
 * Заявки без откликов дольше N часов (по умолчанию сутки): открытые заявки, на которые никто не откликнулся или все отклики
 * отклонены. Фильтр — чипы в адресе (`?hours=`), работает без JavaScript; неверное значение — как по умолчанию. Таблица:
 * заявка, что сделать, режим, заказчик (телефон ссылкой), когда опубликована, сколько ждёт. Раздел из меню: «Назад» не
 * нужно; главной кнопки нет. Сценарии до оферты (замерщик площадки, повторный отклик; флаг `preContractFlows`) в v2 не
 * переносились (этап 6): при включённом флаге — плашка со ссылкой на прежнюю версию раздела.
 */
export default async function StaleRequestsPage({ searchParams }: Props) {
  const user = await requireOperator(to("/operator/requests"));
  const params = await searchParams;
  const raw = params.hours;
  const parsed = staleRequestsSchema.safeParse({ hours: typeof raw === "string" ? raw : undefined });
  const { hours } = parsed.success ? parsed.data : { hours: 24 };
  const rows = await listStaleRequests(user, { hours });
  const c = t.columns;

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      <Chips label={t.filter} items={filterChips("/operator/requests", params, "hours", hoursOptions(hours))} />
      <DataTable
        caption={t.tableCaption}
        captionHidden
        rows={rows}
        rowKey={(r) => r.id}
        empty={t.empty}
        columns={[
          { key: "request", header: c.request, rowHeader: true, cell: (r) => <span className="font-medium whitespace-nowrap">{t.request(r.number)}</span> },
          {
            key: "type",
            header: c.type,
            width: "mid",
            cell: (r) => (
              <span className="flex flex-col items-start gap-1">
                <span>{r.furnitureType?.name ?? r.customType}</span>
                {r.segment && <StatusChip tone="neutral">{t.segments[r.segment]}</StatusChip>}
              </span>
            ),
          },
          { key: "mode", header: c.mode, cell: (r) => t.mode[r.mode] },
          {
            key: "client",
            header: c.client,
            width: "mid",
            cell: (r) => (
              <span className="flex flex-col items-start">
                <span>{r.client.fullName}</span>
                <a href={`tel:${r.client.phone}`} aria-label={t.phoneCall(r.client.phone)} className="inline-flex min-h-control items-center text-ink underline desktop:min-h-control-sm">
                  {r.client.phone}
                </a>
              </span>
            ),
          },
          { key: "published", header: c.published, cell: (r) => <span className="whitespace-nowrap">{formatDateTime(r.publishedAt)}</span> },
          { key: "waiting", header: c.waiting, numeric: true, cell: (r) => t.hours(r.waitingHours) },
          { key: "declined", header: c.declined, numeric: true, cell: (r) => r.declinedOffers },
        ]}
      />
      {isEnabled("preContractFlows") && (
        <Notice tone="warn" title={t.preContract.title}>
          <p>{t.preContract.body}</p>
          <TextLink href={legacy(to("/operator/requests"))}>{t.preContract.link}</TextLink>
        </Notice>
      )}
    </Stack>
  );
}
