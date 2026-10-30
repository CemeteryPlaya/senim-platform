import { notFound } from "next/navigation";
import { ru } from "@/i18n/ru";
import { getChat } from "@/modules/companies";
import { requireUser } from "@/modules/identity";
import { isAppError } from "@/platform/errors";
import { OfferChatClient } from "./OfferChatClient";

export type OfferChatProps = {
  /** Отклик, к которому привязан чат (ADR-003): тот же чат в карточке отклика и в сделке. */
  offerId: string;
  /** Заголовок над лентой; по умолчанию — по роли («Чат с исполнителем» / «Чат с заказчиком»). */
  title?: string;
  /** id секции — якорь для кнопки «Написать (внутренний чат)»: href="#chat". */
  id?: string;
  className?: string;
};

/**
 * Встраиваемый чат отклика (серверная часть). Проверяет доступ и отдаёт первую порцию сообщений;
 * дальше клиентская часть обновляет ленту опросом. Чужой отклик — ошибка NOT_FOUND из companies.
 *
 * Пример: <OfferChat offerId={offer.id} /> в карточке отклика и <OfferChat offerId={deal.offerId} /> в сделке;
 * кнопка «Написать (внутренний чат)» — <ButtonLink href="#chat" variant="secondary">.
 */
export async function OfferChat({ offerId, title, id = "chat", className }: OfferChatProps) {
  const user = await requireUser();
  // Чужой отклик — 404 всей страницы, как будто чата нет (не раскрываем, что такой id существует).
  const chat = await getChat(user, offerId).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    throw e;
  });
  const t = ru.companies.chat;
  const defaultTitle = user.role === "EXECUTOR" ? t.titleForExecutor : user.role === "OPERATOR" ? t.titleForOperator : t.title;
  return <OfferChatClient id={id} offerId={offerId} initial={chat} title={title ?? defaultTitle} className={className} />;
}
