import type { Metadata } from "next";
import { formatDate, formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { DecisionQueue, Notice, PageTitle, QueueCard, Stack, StatusChip } from "@/kit";
import { consentRevocationQueue, type CurrentUser } from "@/modules/identity";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { RevocationDecision } from "./_parts/RevocationDecision";

const t = ru.app.operatorQueues.consents;

export const metadata: Metadata = { title: t.metaTitle };

type Queue = Awaited<ReturnType<typeof consentRevocationQueue>>;

/** Очередь из identity; identity не ответил — `null` (экран объясняет и не падает целиком). Прочие отказы — как есть. */
async function queueOrNull(user: CurrentUser): Promise<Queue | null> {
  try {
    return await consentRevocationQueue(user);
  } catch (e) {
    if (isAppError(e) && e.code === "UNAVAILABLE") return null;
    throw e;
  }
}

/**
 * Отзывы согласия на обработку ПДн (A.7 P6): открытые заявки, ближний срок первым (порядок identity), поэтому заявки с
 * истёкшим сроком — в начале; над очередью — сколько их, у карточки — пометка «Срок истёк». ФИО и последние 4 цифры ИИН —
 * из identity. Решение — «Отзыв исполнен» или отказ с причиной; срок — 15 рабочих дней.
 */
export default async function ConsentRevocationsPage() {
  const user = await requireOperator(to("/operator/consents"));
  const [queue, device] = await Promise.all([queueOrNull(user), getDevice()]);
  const now = new Date();
  const overdue = queue?.filter((item) => item.dueAt < now).length ?? 0;

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      {queue === null ? (
        <Notice tone="warn" live>
          {t.unavailable}
        </Notice>
      ) : (
        <>
          {overdue > 0 && <Notice tone="warn">{t.overdueNotice(overdue)}</Notice>}
          <DecisionQueue count={queue.length} label={t.queueLabel} empty={t.empty}>
            {queue.map((item) => (
              <QueueCard
                key={item.id}
                title={item.fullName ? t.person(item.fullName) : t.noName}
                meta={
                  <span className="flex flex-col items-start gap-2">
                    {item.dueAt < now && <StatusChip tone="danger">{t.overdue}</StatusChip>}
                    <span>
                      {[item.iinLast4 ? t.iin(item.iinLast4) : null, t.requested(formatDateTime(item.requestedAt)), t.due(formatDate(item.dueAt))]
                        .filter((part): part is string => part !== null)
                        .join(" · ")}
                    </span>
                  </span>
                }
              >
                <RevocationDecision device={device} revocationId={item.id} />
              </QueueCard>
            ))}
          </DecisionQueue>
        </>
      )}
    </Stack>
  );
}
