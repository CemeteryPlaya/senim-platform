"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser, SWITCHABLE_ROLES, switchRole } from "@/modules/identity";
import { action } from "@/platform/action";
import { homeFor, safeNext } from "../../_shell/auth";

/**
 * Переключение активной роли (ADR-004): схема zod (только роли переключателя), затем `requireUser` (любая роль — человек
 * может быть в другой), затем identity: она проверяет по выданным ролям, невыданную не выбрать. После — на страницу
 * возврата (только путь v2 этого сайта — safeNext) или в дом новой роли (`homeFor`: для мастера до этапа 4 это временная
 * главная или регистрация мастера). Повтор безопасен: identity переключает на ту же роль без второго эффекта.
 */
export const switchRoleAction = action(
  "app.switchRole",
  z.strictObject({ role: z.enum(SWITCHABLE_ROLES), returnTo: z.string().max(2000).optional() }),
  async ({ role, returnTo }) => {
    const user = await requireUser();
    await switchRole(user, role);
    redirect(safeNext(returnTo) ?? homeFor({ role, executor: user.executor }));
  },
);
