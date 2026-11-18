import type { InvitationStatus, Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";

const t = ru.app.guest.executor.invite;

/** Свой заказ покупателя, к которому можно приглашать (открыт, на всех мастеров, путь ТЗ), и что с приглашением этого мастера. */
export type OwnInvitable = { id: string; number: number; title: string; segment: Segment | null; invitation: InvitationStatus | null };

/**
 * Что показать на странице мастера: ничего, строку состояния без кнопки, кнопку для известного заказа или кнопку с выбором
 * заказа в шторке.
 */
export type InviteView =
  | { kind: "none" }
  | { kind: "note"; text: string }
  | { kind: "context"; label: string; requestId: string }
  | { kind: "pick"; label: string; options: { requestId: string; label: string }[] };

type Input = {
  executor: { publicNumber: number; segment: Segment | null };
  /** Вошёл покупатель; гость и мастер приглашать не могут. */
  buyer: boolean;
  /** Свой подходящий заказ из `?request=`; нет — выбор из `own`. */
  context: OwnInvitable | null;
  /** Все свои подходящие заказы покупателя. */
  own: readonly OwnInvitable[];
};

/** Чистая функция: правила показа приглашения. Решает только вид; права проверяет модуль requests при отправке. */
export function inviteView({ executor, buyer, context, own }: Input): InviteView {
  if (!buyer) return { kind: "none" };
  const same = (r: OwnInvitable) => executor.segment !== null && r.segment === executor.segment;
  if (context) {
    if (!same(context)) return { kind: "note", text: t.otherSegment };
    return stateOf(context) ?? { kind: "context", label: t.action(context.number), requestId: context.id };
  }
  const fit = own.filter(same);
  if (fit.length === 0) return own.length > 0 ? { kind: "note", text: t.otherSegment } : { kind: "none" };
  const free = fit.filter((r) => r.invitation === null);
  if (free.length > 0) {
    return { kind: "pick", label: t.pick, options: free.map((r) => ({ requestId: r.id, label: t.sheet.option(r.number, r.title) })) };
  }
  return stateOf(fit.find((r) => r.invitation !== "DECLINED") ?? fit[0]!) ?? { kind: "none" };
}

/** Приглашение уже есть: строка состояния; нет — `null`. */
function stateOf(r: OwnInvitable): InviteView | null {
  if (r.invitation === null) return null;
  return { kind: "note", text: r.invitation === "DECLINED" ? t.declined(r.number) : t.sent(r.number) };
}
