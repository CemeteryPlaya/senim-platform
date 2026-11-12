import Link from "next/link";
import { ru } from "@/i18n/ru";
import { legacy, to } from "../../_shell/paths";

const t = ru.app.shell;

type Props = { params: Promise<{ rest: string[] }> };

/**
 * Раздел, которого в v2 ещё нет: заглушка «раздел переносится» со ссылкой на тот же адрес в v1.
 * Живёт только до переключения (этап 6).
 */
export default async function Moving({ params }: Props) {
  const { rest } = await params;
  // Сегменты приходят из адреса уже закодированными: повторное кодирование испортило бы ссылку.
  const href = legacy(to(rest.join("/")));

  return (
    <main>
      <h1>{t.movingTitle}</h1>
      <p>{t.movingBody}</p>
      <Link href={href}>{t.openOld}</Link>
    </main>
  );
}
