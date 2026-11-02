"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { becomeClient, endSession, homePathFor, requireUser, safeReturnTo, signOutEverywhere, SWITCHABLE_ROLES, switchRole } from "@/modules/identity";
import { action } from "@/platform/action";

/**
 * Выход. requireUser не вызываем намеренно: выход идемпотентен и трогает только cookie
 * вызывающего — гость или истёкшая сессия просто попадают на главную, а не получают ошибку.
 */
export const logoutAction = action("identity.logout", z.object({ everywhere: z.boolean() }), async ({ everywhere }) => {
  if (everywhere) await signOutEverywhere();
  else await endSession();
  redirect("/");
});

/**
 * Переключение активной роли (ADR-004): роль проверяет identity.switchRole по выданным ролям в БД.
 * После — на страницу возврата (только путь внутри сайта) или на главную выбранной роли.
 */
export const switchRoleAction = action(
  "identity.switchRole",
  z.object({ role: z.enum(SWITCHABLE_ROLES), returnTo: z.string().max(512).optional() }),
  async ({ role, returnTo }) => {
    const user = await requireUser();
    await switchRole(user, role);
    redirect(safeReturnTo(returnTo) ?? homePathFor({ role, executor: user.executor }));
  },
);

/** «Стать заказчиком» из профиля исполнителя: роль выдаётся сразу, сессия переходит в неё. */
export const becomeClientAction = action("identity.becomeClient", z.object({}), async () => {
  const user = await requireUser("EXECUTOR");
  await becomeClient(user);
  redirect(homePathFor({ role: "CLIENT", executor: user.executor }));
});
