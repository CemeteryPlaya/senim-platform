"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, signOutEverywhere } from "@/modules/identity";
import { action } from "@/platform/action";
import { to } from "./paths";
import { forgetRole } from "./role-cookie";

/**
 * Выход из меню профиля v2. Действие v1 (`logoutAction`) живёт в группе (legacy), а v2 её не импортирует — здесь та же
 * функция модуля identity (endSession), та же обёртка `action` со схемой zod. После выхода — вход v2; выбор роли с
 * первого шага входа (если остался) забывается вместе с сессией.
 * requireUser не вызываем намеренно: выход идемпотентен и трогает только cookie вызывающего — гость или истёкшая
 * сессия просто попадают на вход. Недоступный identity — результат с ошибкой «сервис недоступен»: cookie удалена,
 * но сессия на сервере могла остаться, и человек должен об этом узнать.
 */
export const logout = action("identity.logout", z.strictObject({}), async () => {
  await endSession();
  await forgetRole();
  redirect(to("/login"));
});

/**
 * «Выйти на всех устройствах» (профиль): `signOutEverywhere` модуля identity завершает все сессии человека и стирает cookie
 * этого устройства; дальше — как при обычном выходе. Сбой identity — результат с ошибкой, cookie остаётся: человек не вышел
 * и может повторить (окно подтверждения остаётся открытым).
 */
export const logoutEverywhere = action("identity.logoutEverywhere", z.strictObject({}), async () => {
  await signOutEverywhere();
  await forgetRole();
  redirect(to("/login"));
});
