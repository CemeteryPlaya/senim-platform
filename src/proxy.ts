import { NextResponse, type NextRequest } from "next/server";
import { ru } from "@/i18n/ru";
import { demoGate } from "@/platform/demo-gate";
import { env } from "@/platform/env";

/**
 * Демо-стенд за паролем показа: при DEMO_MODE=true и заданном DEMO_ACCESS_PASSWORD весь сайт
 * закрыт basic-auth (кроме вебхуков и cron — решение в demoGate). Без DEMO_MODE ничего не делает.
 */
export function proxy(request: NextRequest) {
  const e = env();
  const decision = demoGate(request.nextUrl.pathname, request.headers.get("authorization"), {
    demoMode: e.DEMO_MODE,
    password: e.DEMO_ACCESS_PASSWORD,
  });
  if (decision === "pass") return NextResponse.next();
  return new NextResponse(ru.identity.demo.accessRequired, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Senim demo", charset="UTF-8"',
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export const config = {
  // Статика сборки и картинки из public/ — без проверки: в них нет данных стенда.
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|img/).*)"],
};
