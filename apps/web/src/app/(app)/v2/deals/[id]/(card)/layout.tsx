import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ReactNode } from "react";
import type { CurrentUser } from "@/modules/identity";
import { pageHref, requireV2User } from "../../../../_shell/auth";
import { partyDealOnce } from "./party-deal-once";

type Props = { children: ReactNode; params: Promise<{ id: string }> };

/**
 * Ворота карточки сделки — до каркаса загрузки (`loading.tsx` рядом). Каркас начинает потоковый ответ, и `notFound()` после
 * него уже не даёт статус 404 (node_modules/next/dist/docs, loading.js → Status codes). Layout той же папки каркас не
 * оборачивает, поэтому «своя сделка» (`partyDeal`: чужая и несуществующая — 404, оператор — в v1, сторона в другой роли —
 * переключение) проверяется здесь. Плата — каркас ждёт одно чтение сделки; страница берёт прочитанное (`partyDealOnce`).
 *
 * Уход на вход, на первый шаг или в другую роль (`requireV2User`) ворота оставляют странице: она знает параметры адреса
 * (`?history=all`) и кладёт их в `next`, а layout адреса с параметрами не получает.
 */
export default async function DealCardGate({ children, params }: Props) {
  const { id } = await params;
  let user: CurrentUser;
  try {
    user = await requireV2User(pageHref(`/deals/${encodeURIComponent(id)}`));
  } catch (error) {
    if (isRedirectError(error)) return children;
    throw error;
  }
  await partyDealOnce(user, id);
  return children;
}
