"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireUser } from "@/modules/identity";
import { markAllRead, openNotification } from "@/modules/notifications";
import { action } from "@/platform/action";

const open = action("notifications.open", z.object({ id: z.string().min(1).max(100) }), async ({ id }) => {
  const user = await requireUser();
  return openNotification(user, id);
});

const markAll = action("notifications.markAllRead", z.object({}), async () => {
  const user = await requireUser();
  await markAllRead(user.id);
});

/** Форма карточки уведомления: отметить прочитанным и перейти к событию (работает и без JS). */
export async function openNotificationForm(formData: FormData): Promise<void> {
  const result = await open({ id: String(formData.get("id") ?? "") });
  redirect(result.ok ? result.data : "/notifications");
}

export async function markAllReadForm(): Promise<void> {
  await markAll({});
  refresh();
}
