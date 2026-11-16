import type { Role } from "@/generated/prisma/enums";
import { isStaffRole } from "@/modules/identity";
import { isOperatorReady } from "./operator-sections";
import { safeLocalPath, v2Href } from "./paths";

/**
 * Куда ведёт уведомление (список и push — одно правило). Ссылка модуля — путь v1 (`/deals/…`, `/operator/money`):
 * - оператор — на экран v2, если раздел перенесён (`OPERATOR_READY`), иначе ссылка v1 как есть: заглушка «раздел
 *   переносится» — лишний шаг;
 * - прочие сотрудники (замерщик) — ссылка v1 как есть: их разделов в v2 нет;
 * - ссылка v1 «как есть» — только путь этого сайта (`safeLocalPath`): чужой адрес — главная.
 * - покупатель и мастер — экран v2 (`v2Href`).
 * Чистая функция.
 */
export function notificationTarget(role: Role, link: string): string {
  if (role === "OPERATOR") {
    const target = v2Href(link);
    const path = target.split(/[?#]/, 1)[0] ?? target;
    return isOperatorReady(path) ? target : safeLocalPath(link);
  }
  if (isStaffRole(role)) return safeLocalPath(link);
  return v2Href(link);
}
