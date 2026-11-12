import { ru } from "@/i18n/ru";
import { ButtonLink } from "@/kit/Button";
import { PageTitle } from "@/kit/PageTitle";

const t = ru.app.shell;

/**
 * Заглушка «раздел переносится» со ссылкой на тот же экран в v1. Ссылка уходит в другой корневой layout — Next делает
 * полную загрузку страницы, поэтому предзагрузка выключена (она скачала бы впустую дерево v1).
 * Живёт только до переключения (этап 6).
 */
export function MovingPlaceholder({ href }: { href: string }) {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.movingTitle} lead={t.movingBody} />
      <ButtonLink href={href} prefetch={false} className="self-start">
        {t.openOld}
      </ButtonLink>
    </div>
  );
}

/** Параметры адреса страницы (searchParams Next) → строка запроса с «?» или пустая; повторяющиеся — все по порядку. */
export function queryOf(search: Readonly<Record<string, string | string[] | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    for (const v of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, v);
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
