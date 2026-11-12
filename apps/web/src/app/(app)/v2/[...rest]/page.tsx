import { MovingPlaceholder, queryOf } from "../../_shell/Moving";

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
  // Адрес v1 — те же сегменты без префикса v2. Сегменты приходят из адреса уже закодированными: повторное
  // кодирование испортило бы ссылку.
  const oldPath = `/${rest.join("/")}`;
  return <MovingPlaceholder href={oldPath + queryOf(search)} />;
}
