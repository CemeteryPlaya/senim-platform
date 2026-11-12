"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession } from "@/modules/identity";
import { action } from "@/platform/action";
import { to } from "./paths";

/**
 * Выход из меню профиля v2. Действие v1 (`logoutAction`) живёт в группе (legacy), а v2 её не импортирует — здесь та же
 * функция модуля identity (endSession), та же обёртка `action` со схемой zod, после выхода — вход v2.
 * requireUser не вызываем намеренно: выход идемпотентен и трогает только cookie вызывающего — гость или истёкшая
 * сессия просто попадают на вход. Недоступный identity — результат с ошибкой «сервис недоступен»: cookie удалена,
 * но сессия на сервере могла остаться, и человек должен об этом узнать.
 */
export const logout = action("identity.logout", z.strictObject({}), async () => {
  await endSession();
  redirect(to("/login"));
});
