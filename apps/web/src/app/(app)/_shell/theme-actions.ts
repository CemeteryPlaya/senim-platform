"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { THEME_COOKIE, type Theme } from "@/kit/theme";
import { action } from "@/platform/action";
import { env } from "@/platform/env";

const themeSchema = z.enum(["system", "light", "dark"]);

/** Год в секундах: выбор темы помнится, пока человек его не сменит. */
const YEAR = 60 * 60 * 24 * 365;

/**
 * Смена темы — через обёртку `action` со схемой zod, как выход (session-actions.ts): неверное значение — результат
 * с ошибкой VALIDATION, кука не меняется, сервер не отвечает 500. Вход и права не проверяются намеренно: тема —
 * настройка браузера, а не учётной записи, и гостю она нужна так же. «Авто» удаляет куку.
 * Кука читается только сервером (layout v2), поэтому httpOnly; Secure — вне dev (в dev — http://localhost).
 * После записи перерисовывается layout v2 (data-theme на <html>, цвет строки состояния): revalidatePath по шаблону
 * маршрута с группой — `/(app)` и тип `layout` (node_modules/next/dist/docs, revalidatePath, «Revalidating a Layout path»).
 */
export const setTheme = action("shell.setTheme", themeSchema, async (theme) => {
  const jar = await cookies();
  if (theme === "system") {
    jar.delete({ name: THEME_COOKIE, path: "/" });
  } else {
    jar.set(THEME_COOKIE, theme, { maxAge: YEAR, sameSite: "lax", secure: env().APP_ENV !== "dev", httpOnly: true, path: "/" });
  }
  revalidatePath("/(app)", "layout");
});

/**
 * То же для формы переключателя (`formAction` кнопки, тема привязана через bind; второй аргумент — FormData формы,
 * он не нужен). Результат форме не нужен: страница перерисуется сама, а неверное значение уже отклонено setTheme.
 */
export async function chooseTheme(theme: Theme): Promise<void> {
  await setTheme(theme);
}
