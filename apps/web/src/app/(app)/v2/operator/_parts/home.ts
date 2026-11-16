import { ru } from "@/i18n/ru";
import { to } from "../../../_shell/paths";

const t = ru.app.operator.home;

/** Числа очередей для главной оператора; `kyc` — `null`, когда identity не ответил. */
export type QueueCounts = { money: number; registrations: number; openDisputes: number; kyc: number | null; stale: number };

export type OperatorHomeView = {
  /** Что требует внимания: только непустые очереди, по порядку срочности (деньги — первыми). */
  todo: { href: string; text: string }[];
  /** Сводка: подпись и число; ноль и «нет связи» приглушены. */
  tiles: { label: string; value: string; muted: boolean }[];
};

/**
 * Вид главной оператора из чисел очередей (чистая функция). Порядок «что требует внимания» — как в v1: деньги в банке,
 * регистрации, открытые споры, документы мастеров, заявки без откликов. Документы мастеров без ответа identity — «—» с
 * подписью «нет связи» в сводке и без строки в «что требует внимания» (неизвестно, есть ли там работа).
 */
export function operatorHome(counts: QueueCounts): OperatorHomeView {
  const todo = [
    { count: counts.money, href: to("/operator/money"), text: t.money },
    { count: counts.registrations, href: to("/operator/executors"), text: t.registrations },
    { count: counts.openDisputes, href: to("/operator/disputes"), text: t.disputes },
    { count: counts.kyc ?? 0, href: to("/operator/kyc"), text: t.kyc },
    { count: counts.stale, href: to("/operator/requests"), text: t.stale },
  ]
    .filter((item) => item.count > 0)
    .map((item) => ({ href: item.href, text: item.text(item.count) }));

  const tile = (label: string, n: number) => ({ label, value: String(n), muted: n === 0 });
  const tiles = [
    tile(t.tiles.money, counts.money),
    tile(t.tiles.registrations, counts.registrations),
    tile(t.tiles.disputes, counts.openDisputes),
    counts.kyc === null ? { label: t.tiles.kycUnavailable, value: t.noValue, muted: true } : tile(t.tiles.kyc, counts.kyc),
    tile(t.tiles.stale, counts.stale),
  ];
  return { todo, tiles };
}
