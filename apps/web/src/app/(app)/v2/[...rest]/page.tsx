import { notFound } from "next/navigation";
import { isLegacyRoute } from "../../_shell/legacy-routes";
import { MovingPlaceholder, queryOf } from "../../_shell/Moving";
import { safeLocalPath } from "../../_shell/paths";

type Props = {
  params: Promise<{ rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Адрес v2 без своей страницы. Есть такой экран в v1 — заглушка «раздел переносится» со ссылкой на тот же адрес в v1 с
 * теми же параметрами (/v2/inspiration?x=1 → /inspiration?x=1); нет — «Страница не найдена» (not-found.tsx группы).
 * Заглушка живёт только до переключения (этап 6).
 */
export default async function Moving({ params, searchParams }: Props) {
  const [{ rest }, search] = await Promise.all([params, searchParams]);
  // Адрес v1 — те же сегменты без префикса v2. Сегменты не кодируются повторно: уже закодированный сегмент
  // испортился бы. Пустые сегменты (/v2//example.com) отбрасываются.
  // Приходят ли сегменты закодированными, Next не документирует: раскодированный `//example.com` или `\example.com`
  // дал бы ссылку на чужой сайт, поэтому готовый адрес проходит safeLocalPath (чужое — «/»).
  const oldPath = `/${rest.filter(Boolean).join("/")}`;
  if (!isLegacyRoute(oldPath)) notFound();
  return <MovingPlaceholder href={safeLocalPath(oldPath + queryOf(search))} />;
}
