import type { ReactNode } from "react";
import { pageHref, partyDeal, requireV2User } from "../../../../_shell/auth";

type Props = { children: ReactNode; params: Promise<{ id: string }> };

/**
 * Ворота карточки сделки — до каркаса загрузки (`loading.tsx` рядом). Каркас начинает потоковый ответ, и `notFound()` после
 * него уже не даёт статус 404 (node_modules/next/dist/docs, loading.js → Status codes). Layout той же папки каркас не
 * оборачивает, поэтому проверки страницы — вход, роль, первые шаги (`requireV2User`) и «своя сделка» (`partyDeal`: чужая и
 * несуществующая — 404, сторона в другой роли — переключение) — идут здесь первыми, а страница повторяет их уже под
 * каркасом. Возврат после входа — без параметров адреса (их знает только страница).
 */
export default async function DealCardGate({ children, params }: Props) {
  const { id } = await params;
  const user = await requireV2User(pageHref(`/deals/${encodeURIComponent(id)}`));
  await partyDeal(user, id);
  return children;
}
