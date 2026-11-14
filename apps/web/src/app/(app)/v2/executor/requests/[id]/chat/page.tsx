import { notFound, redirect } from "next/navigation";
import { getIncomingRequest } from "@/modules/requests";
import { isAppError } from "@/platform/errors";
import { requireMaster } from "../../../../../_shell/auth";
import { to } from "../../../../../_shell/paths";

type Props = { params: Promise<{ id: string }> };

/**
 * Диалог мастера по заявке — адрес, в который `v2Href` переводит ссылку v1 `/executor/requests/<id>#chat` (id своего
 * предложения из неё не узнать). Своё предложение по заявке находит модуль (`getIncomingRequest().myOffer`): есть — диалог
 * `/chats/<offerId>`, нет — экран заявки. Модуль отвечает и за права: чужая и несуществующая заявка — 404, неодобренный
 * мастер (`notApproved`) — на экран заявки, он объяснит статус. Своего экрана у адреса нет — только переход.
 */
export default async function MasterRequestChat({ params }: Props) {
  const { id } = await params;
  const request = to(`/executor/requests/${encodeURIComponent(id)}`);
  const { user } = await requireMaster(`${request}/chat`);
  const view = await getIncomingRequest(user, id).catch((e: unknown) => {
    if (isAppError(e) && e.code === "NOT_FOUND") notFound();
    if (isAppError(e) && e.code === "FORBIDDEN") return null;
    throw e;
  });
  const offerId = view?.myOffer?.id;
  redirect(offerId ? to(`/chats/${encodeURIComponent(offerId)}`) : request);
}
