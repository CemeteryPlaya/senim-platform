import { MovingPlaceholder, queryOf } from "../../_shell/Moving";
import { legacy, to } from "../../_shell/paths";

type Props = {
  params: Promise<{ rest: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Раздел, которого в v2 ещё нет: заглушка «раздел переносится» со ссылкой на тот же адрес в v1 — с теми же
 * параметрами. Живёт только до переключения (этап 6).
 */
export default async function Moving({ params, searchParams }: Props) {
  const [{ rest }, search] = await Promise.all([params, searchParams]);
  // Сегменты приходят из адреса уже закодированными: повторное кодирование испортило бы ссылку.
  return <MovingPlaceholder href={legacy(to(rest.join("/"))) + queryOf(search)} />;
}
