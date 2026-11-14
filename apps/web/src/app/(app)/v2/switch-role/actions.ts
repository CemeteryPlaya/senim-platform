"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, SWITCHABLE_ROLES, switchRole } from "@/modules/identity";
import { action } from "@/platform/action";
import { homeAfterSwitch, safeNext } from "../../_shell/auth";

/**
 * Переключение активной роли (ADR-004): схема zod (только роли переключателя), затем `requireUser` (любая роль — человек
 * может быть в другой), затем identity: она проверяет по выданным ролям, невыданную не выбрать. После — на страницу
 * возврата (только путь v2 этого сайта — safeNext) или в дом новой роли v2 (`homeAfterSwitch`: мастеру — главная или
 * регистрация мастера). Повтор безопасен: identity переключает на ту же роль без второго эффекта.
 */
export const switchRoleAction = action(
  "app.switchRole",
  z.strictObject({ role: z.enum(SWITCHABLE_ROLES), returnTo: z.string().max(2000).optional() }),
  async ({ role, returnTo }) => {
    const user = await requireUser();
    await switchRole(user, role);
    redirect(safeNext(returnTo) ?? homeAfterSwitch({ role, executor: user.executor }));
  },
);
