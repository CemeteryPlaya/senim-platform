"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { markAllRead, openNotification } from "@/modules/notifications";
import { action } from "@/platform/action";
import { notificationTarget } from "../../_shell/notification-target";
import { to } from "../../_shell/paths";

// Действия экрана уведомлений (v2): свои обёртки над функциями модуля `notifications`. Счётчик на колокольчике читает
// layout, поэтому после каждого изменения слой `(app)` сбрасывается: иначе при мягком переходе число осталось бы старым.

const open = action("app.notifications.open", z.strictObject({ id: z.string().min(1).max(100) }), async ({ id }) => {
  const user = await requireUser();
  const link = await openNotification(user, id);
  revalidatePath("/(app)", "layout");
  return notificationTarget(user.role, link);
});

const markAll = action("app.notifications.markAllRead", z.strictObject({}), async () => {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/(app)", "layout");
});

/**
 * Карточка уведомления — форма: отметить прочитанным и перейти туда, куда оно ведёт. Ссылка из модуля — путь v1
 * (`/deals/…`, `/requests/…`), куда вести — решает `notificationTarget` (то же правило, что у push). Не открылось (чужое,
 * пропало) — остаёмся в списке.
 */
export async function openNotificationForm(formData: FormData): Promise<void> {
  const result = await open({ id: String(formData.get("id") ?? "") });
  redirect(result.ok ? result.data : to("/notifications"));
}

/**
 * «Прочитать все». Ошибка не глотается: истёкшая сессия — страница списка сама отправит на вход (ворота), прочий сбой —
 * на список с `?error=1`, где над списком сообщение.
 */
export async function markAllReadForm(): Promise<void> {
  const result = await markAll({});
  if (!result.ok) redirect(`${to("/notifications")}?error=1`);
}
