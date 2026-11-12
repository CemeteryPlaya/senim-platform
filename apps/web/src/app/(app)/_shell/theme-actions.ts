"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { THEME_COOKIE, type Theme } from "@/kit/theme";
import { env } from "@/platform/env";

const themeSchema = z.enum(["system", "light", "dark"]);

/** Год в секундах: выбор темы помнится, пока человек его не сменит. */
const YEAR = 60 * 60 * 24 * 365;

/**
 * Смена темы. Вход и права не проверяются намеренно: тема — настройка браузера, а не учётной записи, и гостю она нужна
 * так же. Значение проверяет схема zod (неверное — ошибка, кука не меняется). «Как в системе» удаляет куку.
 * Кука читается только сервером (layout v2), поэтому httpOnly; Secure — вне dev (в dev — http://localhost).
 * После записи перерисовывается layout v2 (data-theme на <html>, цвет строки состояния): revalidatePath по шаблону
 * маршрута с группой — `/(app)` и тип `layout` (node_modules/next/dist/docs, revalidatePath, «Revalidating a Layout path»).
 */
export async function setTheme(theme: Theme): Promise<void> {
  const value = themeSchema.parse(theme);
  const jar = await cookies();
  if (value === "system") {
    jar.delete({ name: THEME_COOKIE, path: "/" });
  } else {
    jar.set(THEME_COOKIE, value, { maxAge: YEAR, sameSite: "lax", secure: env().APP_ENV !== "dev", httpOnly: true, path: "/" });
  }
  revalidatePath("/(app)", "layout");
}
