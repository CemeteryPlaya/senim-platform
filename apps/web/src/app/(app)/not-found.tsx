import { ru } from "@/i18n/ru";
import { ButtonLink, PageTitle } from "@/kit";
import { to } from "./_shell/paths";

const t = ru.app.shell;

/**
 * «Страница не найдена» нового интерфейса: notFound() из любой страницы под (app) показывает её внутри оболочки v2
 * (файл лежит рядом с корневым layout группы — node_modules/next/dist/docs, not-found.js). Статус 404 и
 * `noindex` ставит Next. Неизвестные адреса v2 приходят сюда из заглушки [...rest]: перенос она показывает только для экранов v1.
 */
export default function NotFound() {
  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.notFoundTitle} lead={t.notFoundBody} />
      <ButtonLink href={to("/")} className="self-start">
        {t.notFoundAction}
      </ButtonLink>
    </div>
  );
}
