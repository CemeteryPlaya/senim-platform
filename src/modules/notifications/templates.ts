import type { Segment } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { formatDateTime, formatMoney } from "@/ui/format";

/**
 * Шаблоны уведомлений: ключ → заголовок, текст, ссылка; sms — дублировать ли SMS (важные события).
 * Ключ сохраняется в Notification.kind. Тексты — в ru.notifications.templates.
 * Модули вызывают notifyTemplate(tx, userId, key, params) в транзакции изменения состояния.
 */

export type Rendered = { title: string; body: string; link?: string };
type Template<P> = { sms: boolean; render(params: P): Rendered };

const t = ru.notifications.templates;

const links = {
  request: (id: string) => `/requests/${id}`,
  executorRequest: (id: string) => `/executor/requests/${id}`,
  deal: (id: string) => `/deals/${id}`,
  operatorExecutor: (id: string) => `/operator/executors/${id}`,
  operatorDispute: (id: string) => `/operator/disputes/${id}`,
};

/** Получатель по заявке: заказчику — его заявка, исполнителю — входящая. */
type RequestAudience = { audience: "client" | "executor"; requestId: string };
const requestLink = (p: RequestAudience) => (p.audience === "client" ? links.request(p.requestId) : links.executorRequest(p.requestId));

const template = <P>(sms: boolean, render: (params: P) => Rendered): Template<P> => ({ sms, render });

type DealRef = { dealId: string; dealTitle: string };

export const TEMPLATES = {
  // ─── заявки и отклики ───
  "request.new": template<{ requestId: string; summary: string }>(false, (p) => ({ ...t.requestNew(p.summary), link: links.executorRequest(p.requestId) })),
  "request.direct": template<{ requestId: string; portfolioTitle: string }>(true, (p) => ({
    ...t.requestDirect(p.portfolioTitle),
    link: links.executorRequest(p.requestId),
  })),
  "offer.received": template<{ requestId: string; requestTitle: string; price: number; durationDays: number }>(false, (p) => ({
    ...t.offerReceived(p.requestTitle, formatMoney(p.price), p.durationDays),
    link: links.request(p.requestId),
  })),
  "offer.chosen": template<{ requestId: string; requestTitle: string }>(false, (p) => ({ ...t.offerChosen(p.requestTitle), link: links.request(p.requestId) })),
  "offer.accepted": template<{ requestId: string; requestTitle: string }>(true, (p) => ({
    ...t.offerAccepted(p.requestTitle),
    link: links.executorRequest(p.requestId),
  })),
  "offer.declined": template<{ requestId: string; requestTitle: string }>(false, (p) => ({
    ...t.offerDeclined(p.requestTitle),
    link: links.executorRequest(p.requestId),
  })),

  // ─── замер ───
  "measurement.scheduled": template<RequestAudience & { requestTitle: string; at: Date }>(false, (p) => ({
    ...t.measurementScheduled(p.requestTitle, formatDateTime(p.at)),
    link: requestLink(p),
  })),
  "measurement.reminder": template<RequestAudience & { requestTitle: string; at: Date }>(true, (p) => ({
    ...t.measurementReminder(p.requestTitle, formatDateTime(p.at)),
    link: requestLink(p),
  })),
  "measurement.no_deal": template<{ requestId: string; requestTitle: string; fee: number | null }>(false, (p) => ({
    ...t.measurementNoDeal(p.requestTitle, p.fee ? formatMoney(p.fee) : null),
    link: links.request(p.requestId),
  })),

  // Сделка и деньги шлёт deal-core готовым текстом (ru.deal.notify, ru.payments.notify) — см. SMS_TEXT_KINDS.

  // ─── споры и отзывы ───
  "dispute.opened": template<{ audience: "party"; dealId: string; dealTitle: string } | { audience: "operator"; disputeId: string; dealTitle: string }>(
    true,
    (p) => ({ ...t.disputeOpened(p.dealTitle), link: p.audience === "party" ? links.deal(p.dealId) : links.operatorDispute(p.disputeId) }),
  ),
  "dispute.resolved": template<DealRef>(true, (p) => ({ ...t.disputeResolved(p.dealTitle), link: links.deal(p.dealId) })),
  "review.received": template<DealRef & { rating: number }>(false, (p) => ({ ...t.reviewReceived(p.dealTitle, p.rating), link: links.deal(p.dealId) })),

  // ─── регистрация исполнителя ───
  "registration.received": template<Record<string, never>>(false, () => t.registrationReceived()),
  "registration.pending": template<{ profileId: string; summary: string }>(false, (p) => ({
    ...t.registrationPending(p.summary),
    link: links.operatorExecutor(p.profileId),
  })),
  "registration.approved": template<{ segment: Segment }>(true, (p) => t.registrationApproved(ru.notifications.segments[p.segment])),
  "registration.rejected": template<{ reason: string }>(true, (p) => t.registrationRejected(p.reason)),

  // ─── вход ───
  /** Операторам: суточный потолок кодов на новые номера исчерпан (не чаще раза в сутки). Только in-app. */
  "otp.global_limit": template<{ limit: number }>(false, (p) => t.otpGlobalLimit(p.limit)),
} as const;

export type TemplateKey = keyof typeof TEMPLATES;

/**
 * Важные виды, которые модули шлют готовым текстом (notify), а не шаблоном: тоже дублируются SMS.
 * deal-core: оферта ждёт подписи, работа сдана — нужен ответ стороны. Деньги (money.*) идут
 * push и in-app на каждое изменение (ТЗ п. 4.3); SMS по ним не шлём — это дорого и дублирует push.
 */
export const SMS_TEXT_KINDS = ["deal.offer.ready", "deal.ready"] as const;

/** Все виды уведомлений, которые дублируются SMS: шаблоны с sms: true и SMS_TEXT_KINDS. */
export const SMS_KINDS: ReadonlySet<string> = new Set<string>([
  ...(Object.keys(TEMPLATES) as TemplateKey[]).filter((key) => TEMPLATES[key].sms),
  ...SMS_TEXT_KINDS,
]);
export type TemplateParams<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]["render"]>[0];

export function renderTemplate<K extends TemplateKey>(key: K, params: TemplateParams<K>): Rendered {
  const render = TEMPLATES[key].render as (p: TemplateParams<K>) => Rendered;
  return render(params);
}
