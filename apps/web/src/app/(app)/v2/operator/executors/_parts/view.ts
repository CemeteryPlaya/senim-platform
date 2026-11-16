import { formatDateTime } from "@/features/format/format";
import type { RegistrationStatus } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { StatusTone, StepState, TimelineItem } from "@/kit";
import type { AuditView } from "@/modules/operator";

const q = ru.app.operatorQueues;
const c = q.executors.card;

/** Статусы регистрации в порядке фильтра. */
export const REGISTRATION_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const satisfies readonly RegistrationStatus[];

/** Тон чипа регистрации: ждёт — warn (от оператора нужно действие), подтверждён — accent, отклонён — danger. */
export const STATUS_TONE: Readonly<Record<RegistrationStatus, StatusTone>> = { PENDING: "warn", APPROVED: "accent", REJECTED: "danger" };

/** Фильтр статуса из адреса: неизвестное значение — «Все» (`undefined`). */
export function statusParam(raw: string | string[] | undefined): RegistrationStatus | undefined {
  return typeof raw === "string" && (REGISTRATION_STATUSES as readonly string[]).includes(raw) ? (raw as RegistrationStatus) : undefined;
}

/** Ход регистрации: заявка → проверка оператором → решение (подпись решения — итог, пока его нет — «Решение»). */
export function registrationSteps(status: RegistrationStatus): { label: string; state: StepState }[] {
  const pending = status === "PENDING";
  return [
    { label: c.steps.submitted, state: "done" },
    { label: c.steps.review, state: pending ? "current" : "done" },
    { label: pending ? c.steps.decision : q.registration[status], state: pending ? "todo" : "done" },
  ];
}

/** Причина смены сегмента из журнала (`meta.reason`) — строкой под событием; иначе ничего. */
function reasonOf(meta: unknown): string | undefined {
  if (typeof meta !== "object" || meta === null || !("reason" in meta)) return undefined;
  const reason = (meta as { reason: unknown }).reason;
  return typeof reason === "string" && reason !== "" ? reason : undefined;
}

/** Журнал исполнителя → лента: действие словами (незнакомое — кодом), время и кто, причина смены сегмента. */
export function historyItems(events: readonly AuditView[]): TimelineItem[] {
  return events.map((event) => {
    const text = reasonOf(event.meta);
    return {
      title: c.actions[event.action] ?? event.action,
      time: c.historyTime(formatDateTime(event.createdAt), c.byRole[event.actorRole] ?? event.actorRole),
      ...(text ? { text } : {}),
    };
  });
}
