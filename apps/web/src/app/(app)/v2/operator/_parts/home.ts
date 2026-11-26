import { ru } from "@/i18n/ru";
import { to } from "../../../_shell/paths";

const t = ru.app.operator.home;

/** Числа очередей для главной оператора; `kyc` — `null`, когда identity не ответил. */
export type QueueCounts = { money: number; registrations: number; openDisputes: number; kyc: number | null; stale: number };

export type OperatorHomeView = {
  /** Что требует внимания: только непустые очереди, по порядку срочности (деньги — первыми). */
  todo: { href: string; text: string }[];
};

/**
 * Вид главной оператора из чисел очередей (чистая функция). Порядок «что требует внимания» — как в v1: деньги в банке,
 * регистрации, открытые споры, документы мастеров, заявки без откликов. Пустые очереди не показываются; отдельной сводки
 * числами нет — она повторяла этот же список. Документы мастеров без ответа identity — строка «нет связи» на своём месте:
 * неизвестно, есть ли там работа, но оператор видит, что число не получено.
 */
export function operatorHome(counts: QueueCounts): OperatorHomeView {
  const kyc = counts.kyc === null ? { count: 1, text: () => t.kycUnavailable } : { count: counts.kyc, text: t.kyc };
  const todo = [
    { count: counts.money, href: to("/operator/money"), text: t.money },
    { count: counts.registrations, href: to("/operator/executors"), text: t.registrations },
    { count: counts.openDisputes, href: to("/operator/disputes"), text: t.disputes },
    { ...kyc, href: to("/operator/kyc") },
    { count: counts.stale, href: to("/operator/requests"), text: t.stale },
  ]
    .filter((item) => item.count > 0)
    .map((item) => ({ href: item.href, text: item.text(item.count) }));
  return { todo };
}
