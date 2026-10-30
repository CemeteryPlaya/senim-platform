import type { RegistrationStatus, RequestMode, RequestStatus, Role, Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { executorSeesRequest } from "@/modules/requests/client";
import { db } from "@/platform/db";

/** Кто смотрит. Сегмент исполнителя нужен для тендеров (в CurrentUser его нет — догружаем). */
export type Viewer = {
  id: string;
  role: Role;
  executor: { id: string; status: RegistrationStatus; segment: Segment | null } | null;
} | null;

export type RequestFacts = {
  clientId: string;
  mode: RequestMode;
  status: RequestStatus;
  segment: Segment | null;
  targetExecutorId: string | null;
  /** У смотрящего исполнителя есть отклик на эту заявку. */
  viewerHasOffer: boolean;
};

/** Что известно о файле для решения о доступе. */
export type FileFacts = {
  uploadedById: string | null;
  owner:
    | { kind: "portfolio"; published: boolean; ownerUserId: string }
    | { kind: "request"; request: RequestFacts }
    | { kind: "parties"; userIds: readonly string[] }
    | { kind: "none" };
};

/** Решение о доступе — чистая функция; загрузку фактов делает canReadFile. */
export function decideFileAccess(viewer: Viewer, facts: FileFacts): boolean {
  const { owner } = facts;
  if (owner.kind === "portfolio" && owner.published) return true;
  if (!viewer) return false;
  if (viewer.role === "OPERATOR") return true;
  if (facts.uploadedById === viewer.id) return true;
  switch (owner.kind) {
    case "portfolio":
      return owner.ownerUserId === viewer.id;
    case "parties":
      return owner.userIds.includes(viewer.id);
    case "request":
      if (owner.request.clientId === viewer.id) return true;
      return viewer.executor !== null && executorSeesRequest(viewer.executor, owner.request);
    case "none":
      return false;
  }
}

const dealParties = { select: { clientId: true, executor: { select: { userId: true } } } } as const;

function requestSelect(executorId: string | undefined) {
  return {
    select: {
      clientId: true,
      mode: true,
      status: true,
      segment: true,
      targetExecutorId: true,
      offers: { where: { executorId: executorId ?? "" }, select: { id: true }, take: 1 },
    },
  } as const;
}

async function loadFacts(fileId: string, executorId: string | undefined): Promise<FileFacts | null> {
  const req = requestSelect(executorId);
  const f = await db.storedFile.findUnique({
    where: { id: fileId },
    select: {
      uploadedById: true,
      portfolioItem: { select: { published: true, executor: { select: { userId: true } } } },
      request: req,
      visualization: { select: { request: req } },
      stage: { select: { deal: dealParties } },
      dispute: { select: { deal: dealParties } },
      document: { select: { deal: dealParties } },
      message: { select: { offer: { select: { executor: { select: { userId: true } }, request: { select: { clientId: true } } } } } },
    },
  });
  if (!f) return null;
  const facts = (owner: FileFacts["owner"]): FileFacts => ({ uploadedById: f.uploadedById, owner });
  const parties = (deal: { clientId: string; executor: { userId: string } }) => facts({ kind: "parties", userIds: [deal.clientId, deal.executor.userId] });

  if (f.portfolioItem) return facts({ kind: "portfolio", published: f.portfolioItem.published, ownerUserId: f.portfolioItem.executor.userId });
  const request = f.request ?? f.visualization?.request;
  if (request) {
    const { offers, ...rest } = request;
    return facts({ kind: "request", request: { ...rest, viewerHasOffer: offers.length > 0 } });
  }
  const deal = f.stage?.deal ?? f.dispute?.deal ?? f.document?.deal;
  if (deal) return parties(deal);
  if (f.message) return facts({ kind: "parties", userIds: [f.message.offer.request.clientId, f.message.offer.executor.userId] });
  return facts({ kind: "none" });
}

async function viewerOf(user: CurrentUser | null): Promise<Viewer> {
  if (!user) return null;
  if (!user.executor) return { id: user.id, role: user.role, executor: null };
  const profile = await db.executorProfile.findUnique({ where: { id: user.executor.id }, select: { segment: true } });
  return { id: user.id, role: user.role, executor: { id: user.executor.id, status: user.executor.status, segment: profile?.segment ?? null } };
}

/**
 * Права на файл по сущности-владельцу: портфолио — публично; фото помещения — заказчик и исполнители,
 * видящие заявку; этап, спор, документ, вложение чата — стороны; оператор — всё; гость — только портфолио.
 *
 * Правило для маршрутов «файл по id» без сущности-владельца на руках (ADR-003: право проверяется при
 * выдаче ссылки). Сервисы, которые сейчас выдают fileUrl, уже проверяют доступ к своей сущности и
 * сюда не ходят: фото помещения — requests (loadOwnRequest / visibleToExecutor), этапа — deal-core
 * (loadView: сторона или оператор), спора — operator (assertOperator), визуализации — ai
 * (readableRequest), портфолио — companies (опубликовано или своё). Вложения чата отдаются только id.
 */
export async function canReadFile(user: CurrentUser | null, file: { id: string }): Promise<boolean> {
  const facts = await loadFacts(file.id, user?.executor?.id);
  if (!facts) return false;
  return decideFileAccess(await viewerOf(user), facts);
}
