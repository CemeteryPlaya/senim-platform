import { cookies } from "next/headers";

/** Тема интерфейса: «как в системе» (prefers-color-scheme), светлая или тёмная. */
export type Theme = "system" | "light" | "dark";

/** Кука с выбором темы: сервер читает её и отдаёт страницу сразу в нужной теме, без мигания. */
export const THEME_COOKIE = "theme";

/** Значение куки → тема. Всё, кроме точных `light` и `dark`, — «как в системе». */
export function parseTheme(raw: string | undefined): Theme {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** Тема текущего запроса. Только для серверных компонентов. */
export async function getTheme(): Promise<Theme> {
  return parseTheme((await cookies()).get(THEME_COOKIE)?.value);
}
