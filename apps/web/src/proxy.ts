import { NextResponse, type NextRequest } from "next/server";
import { ru } from "@/i18n/ru";
import { standGate } from "@/platform/stand-gate";
import { env } from "@/platform/env";

/**
 * Стенд за паролем: при заданном STAND_ACCESS_PASSWORD (только вне APP_ENV=prod — env.ts) весь сайт закрыт basic-auth
 * (кроме вебхуков и cron — решение в standGate). Без пароля ничего не делает.
 */
export function proxy(request: NextRequest) {
  const decision = standGate(request.nextUrl.pathname, request.headers.get("authorization"), { password: env().STAND_ACCESS_PASSWORD });
  if (decision === "pass") return NextResponse.next();
  return new NextResponse(ru.identity.stand.accessRequired, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Senim stand", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // Статика сборки и картинки из public/ — без проверки: в них нет данных стенда. Временные фото мебели (stand-photos/)
  // и снимки экранов лендинга (app-screens/) тоже публичны: оптимизатор /_next/image запрашивает их у сервера без
  // basic-auth, и за паролем стенда ни одно фото не грузилось. Приватные фото (отчёты, сдача) идут через /api/files
  // по подписанной ссылке и остаются за паролем.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|img/|stand-photos/|app-screens/).*)"],
};
