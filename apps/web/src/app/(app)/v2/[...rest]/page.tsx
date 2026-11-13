import { MovingPlaceholder, queryOf } from "../../_shell/Moving";
import { safeLocalPath } from "../../_shell/paths";

type Props = {
  params: Promise<{ rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Раздел, которого в v2 ещё нет: заглушка «раздел переносится» со ссылкой на тот же адрес в v1 — с теми же
 * параметрами (/v2/deals/1?tab=money → /deals/1?tab=money). Живёт только до переключения (этап 6).
 */
export default async function Moving({ params, searchParams }: Props) {
  const [{ rest }, search] = await Promise.all([params, searchParams]);
  // Адрес v1 — те же сегменты без префикса v2. Сегменты не кодируются повторно: уже закодированный сегмент
  // испортился бы. Пустые сегменты (/v2//example.com) отбрасываются.
  // Приходят ли сегменты закодированными, Next не документирует: раскодированный `//example.com` или `\example.com`
  // дал бы ссылку на чужой сайт, поэтому готовый адрес проходит safeLocalPath (чужое — «/»).
  const oldPath = `/${rest.filter(Boolean).join("/")}`;
  return <MovingPlaceholder href={safeLocalPath(oldPath + queryOf(search))} />;
}
