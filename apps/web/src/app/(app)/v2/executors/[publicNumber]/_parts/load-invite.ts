import "server-only";
import type { Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { getClientRequest, listInvitations, listMyRequests } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { invitable } from "../../_parts/list-view";
import { inviteView, type InviteView, type OwnInvitable } from "./invite";

/** Не больше стольких своих заказов разбираем для выбора в шторке (открытых тендеров у покупателя бывает несколько). */
const OWN_LIMIT = 20;

/** Свой заказ с состоянием приглашения этого мастера; чужой, закрытый, не тендер и не путь ТЗ — `null`. Права — у модуля. */
async function ownInvitable(user: CurrentUser, requestId: string, publicNumber: number): Promise<OwnInvitable | null> {
  try {
    const r = await getClientRequest(user, requestId);
    if (!invitable(r)) return null;
    const mine = (await listInvitations(user, requestId)).find((x) => x.publicNumber === publicNumber);
    return { id: r.id, number: r.number, title: r.title, segment: r.segment as Segment | null, invitation: mine?.status ?? null };
  } catch (e) {
    if (isAppError(e) && (e.code === "NOT_FOUND" || e.code === "FORBIDDEN")) return null;
    throw e;
  }
}

/**
 * Приглашение на странице мастера: покупателю — по заказу из адреса (`?request=`, только свой подходящий), иначе по его
 * подходящим заказам. Гостю и мастеру — ничего. Решает `inviteView`; здесь только чтение.
 */
export async function loadInvite(
  user: CurrentUser | null,
  executor: { publicNumber: number; segment: Segment | null },
  requestId: string | null,
): Promise<InviteView> {
  if (!user || user.role !== "CLIENT") return { kind: "none" };
  const context = requestId ? await ownInvitable(user, requestId, executor.publicNumber) : null;
  if (context) return inviteView({ executor, buyer: true, context, own: [] });
  const open = (await listMyRequests(user)).filter((r) => r.status === "OPEN" && r.mode === "TENDER").slice(0, OWN_LIMIT);
  const own = (await Promise.all(open.map((r) => ownInvitable(user, r.id, executor.publicNumber)))).filter((r): r is OwnInvitable => r !== null);
  return inviteView({ executor, buyer: true, context: null, own });
}
