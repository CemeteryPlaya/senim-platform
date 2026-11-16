import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { openNotification } from "@/modules/notifications";
import { isAppError } from "@/platform/errors";
import { requireV2User } from "../../../../_shell/auth";
import { to, v2Href } from "../../../../_shell/paths";

/**
 * Нажатие на push: отметить уведомление прочитанным и открыть то, куда оно ведёт, — в интерфейсе v2 (ссылка модуля — путь v1,
 * на экран v2 её переводит `v2Href`). Сервис-воркер открывает этот адрес по `tag` уведомления (= id в модуле), поэтому push,
 * присланный со старой ссылкой, всё равно приводит в v2. Без входа — на вход с возвратом сюда. Чужое или пропавшее
 * уведомление — список уведомлений. Идемпотентно: повторное открытие ничего не меняет. Своё — по `openNotification` модуля.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }): Promise<never> {
  const { id } = await ctx.params;
  const user = await requireV2User(to(`/notifications/${encodeURIComponent(id)}/open`));
  let target: string;
  try {
    target = v2Href(await openNotification(user, id));
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") redirect(to("/notifications"));
    throw error;
  }
  // Счётчик колокольчика читает layout: сбросить, чтобы число обновилось.
  revalidatePath("/(app)", "layout");
  redirect(target);
}
