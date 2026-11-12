import "server-only";
import { cache } from "react";
import { headers } from "next/headers";

/** Версия интерфейса: телефонная или компьютерная. Решает сервер по заголовкам запроса. */
export type Device = "mobile" | "desktop";

const MOBILE_UA = /iPhone|iPad|iPod|Android/i;

/**
 * Чистое решение по заголовкам; ширина окна и CSS-брейкпоинты не участвуют.
 * Порядок правил:
 * 1. `sec-ch-ua-mobile: ?1` — mobile.
 * 2. User-Agent с iPhone, iPad, iPod или Android — mobile (так планшеты Android без слова
 *    `Mobile` и при `?0` получают телефонную версию).
 * 3. Иначе (в том числе без заголовков и curl) — desktop.
 *
 * Известное ограничение, принятое владельцем продукта: iPadOS Safari в режиме «как Mac»
 * (`Macintosh; Intel Mac OS X`) по заголовкам неотличим от Mac и получает desktop.
 * Принятое допущение: Android TV (в UA есть `Android`) получает mobile — управление пультом ближе к телефонной
 * версии, чем к компьютерной, а отдельной версии для телевизора нет.
 */
export function deviceFromHeaders(get: (name: string) => string | null): Device {
  if (get("sec-ch-ua-mobile")?.trim() === "?1") return "mobile";
  const userAgent = get("user-agent");
  if (userAgent !== null && MOBILE_UA.test(userAgent)) return "mobile";
  return "desktop";
}

/** Устройство текущего запроса; в пределах одного рендера считается один раз. */
export const getDevice = cache(async (): Promise<Device> => {
  const h = await headers();
  return deviceFromHeaders((name) => h.get(name));
});
