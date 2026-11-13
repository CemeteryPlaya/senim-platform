"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { markAllRead, openNotification } from "@/modules/notifications";
import { action } from "@/platform/action";
import { to, v2Href } from "../../_shell/paths";

// Действия экрана уведомлений (v2): свои обёртки над функциями модуля `notifications`. Счётчик на колокольчике читает
// layout, поэтому после каждого изменения слой `(app)` сбрасывается: иначе при мягком переходе число осталось бы старым.

const open = action("app.notifications.open", z.strictObject({ id: z.string().min(1).max(100) }), async ({ id }) => {
  const user = await requireUser();
  const link = await openNotification(user, id);
  revalidatePath("/(app)", "layout");
  return link;
});

const markAll = action("app.notifications.markAllRead", z.strictObject({}), async () => {
  const user = await requireUser();
  await markAllRead(user.id);
  revalidatePath("/(app)", "layout");
});

/**
 * Карточка уведомления — форма: отметить прочитанным и перейти туда, куда оно ведёт. Ссылка из модуля — путь v1
 * (`/deals/…`, `/requests/…`), на экран v2 её переводит `v2Href`. Не открылось (чужое, пропало) — остаёмся в списке.
 */
export async function openNotificationForm(formData: FormData): Promise<void> {
  const result = await open({ id: String(formData.get("id") ?? "") });
  redirect(result.ok ? v2Href(result.data) : to("/notifications"));
}

/** «Прочитать все». */
export async function markAllReadForm(): Promise<void> {
  await markAll({});
}
