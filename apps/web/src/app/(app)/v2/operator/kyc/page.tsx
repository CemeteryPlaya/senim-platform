import type { Metadata } from "next";
import { formatDateTime } from "@/features/format/format";
import { ru } from "@/i18n/ru";
import { DecisionQueue, Notice, PageTitle, QueueCard, Stack, TextLink } from "@/kit";
import type { CurrentUser } from "@/modules/identity";
import { kycQueue, type KycQueueItem } from "@/modules/operator";
import { getDevice } from "@/platform/device";
import { isAppError } from "@/platform/errors";
import { requireOperator } from "../../../_shell/auth";
import { to } from "../../../_shell/paths";
import { KycDecision } from "./_parts/KycDecision";

const q = ru.app.operatorQueues;
const t = q.kyc;

export const metadata: Metadata = { title: t.metaTitle };

/** Очередь из identity; identity не ответил — `null` (экран объясняет и не падает целиком). Прочие отказы — как есть. */
async function queueOrNull(user: CurrentUser): Promise<KycQueueItem[] | null> {
  try {
    return await kycQueue(user);
  } catch (e) {
    if (isAppError(e) && e.code === "UNAVAILABLE") return null;
    throw e;
  }
}

/** Строка под заголовком: форма и ИИН/БИН (последние 4), ФИО для сверки с удостоверением, время подачи. */
function metaOf(item: KycQueueItem): string {
  return [
    q.legal(q.legalForms[item.legalForm], item.binIinLast4),
    item.fullName ? t.person(item.fullName) : null,
    item.submittedAt ? t.submitted(formatDateTime(item.submittedAt)) : null,
  ]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/**
 * Документы мастеров (KYC): очередь — identity, давно ждущие первыми. Документы — по подписанной ссылке на 15 минут
 * (выдача пишется в журнал; ссылки выдаёт модуль после проверки роли), открываются в новой вкладке. ИИН/БИН — последние
 * 4 цифры. Решение — «Документы в порядке» или отказ с причиной; время подачи защищает от решения по старым документам.
 * Не все документы сошлись — пометка вместо решения.
 */
export default async function KycQueuePage() {
  const user = await requireOperator(to("/operator/kyc"));
  const [queue, device] = await Promise.all([queueOrNull(user), getDevice()]);

  return (
    <Stack gap="section">
      <PageTitle title={t.title} lead={t.lead} />
      {queue === null ? (
        <Notice tone="warn" live>
          {t.unavailable}
        </Notice>
      ) : (
        <DecisionQueue count={queue.length} label={t.queueLabel} empty={t.empty}>
          {queue.map((item) => (
            <QueueCard key={item.executorId} title={q.executor(item.publicNumber, item.legalName)} meta={metaOf(item)}>
              <ul aria-label={t.documents} className="flex flex-col">
                {item.documents.map((d) => (
                  <li key={d.id}>
                    <TextLink href={d.url} external>
                      {t.purposes[d.purpose]}
                    </TextLink>
                  </li>
                ))}
                <li>
                  <TextLink href={to(`/operator/executors/${encodeURIComponent(item.executorId)}`)}>{t.openCard}</TextLink>
                </li>
              </ul>
              {item.complete && item.submittedAtExact ? (
                <KycDecision device={device} userId={item.userId} submittedAt={item.submittedAtExact} />
              ) : (
                <Notice tone="warn">{t.incomplete}</Notice>
              )}
            </QueueCard>
          ))}
        </DecisionQueue>
      )}
    </Stack>
  );
}
