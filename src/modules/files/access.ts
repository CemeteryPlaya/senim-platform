import type { RegistrationStatus, RequestMode, RequestStatus, Role, Segment } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { executorSeesRequest } from "@/modules/requests/client";
import { db, type Prisma } from "@/platform/db";

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
  return viewer.role === "OPERATOR" || facts.uploadedById === viewer.id || ownerAllows(viewer, owner);
}

/** Доступ по владельцу файла: автор портфолио, стороны сделки, заказчик заявки или исполнитель, который её видит. */
function ownerAllows(viewer: NonNullable<Viewer>, owner: FileFacts["owner"]): boolean {
  switch (owner.kind) {
    case "portfolio":
      return owner.ownerUserId === viewer.id;
    case "parties":
      return owner.userIds.includes(viewer.id);
    case "request":
      return owner.request.clientId === viewer.id || (viewer.executor !== null && executorSeesRequest(viewer.executor, owner.request));
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

type DealParties = { clientId: string; executor: { userId: string } };
const partiesOf = (deal: DealParties) => [deal.clientId, deal.executor.userId];

function ownersSelect(executorId: string | undefined) {
  const req = requestSelect(executorId);
  return {
    uploadedById: true,
    portfolioItem: { select: { published: true, executor: { select: { userId: true } } } },
    request: req,
    visualization: { select: { request: req } },
    deal: dealParties,
    progressReport: { select: { deal: dealParties } },
    dispute: { select: { deal: dealParties } },
    document: { select: { deal: dealParties } },
    message: { select: { offer: { select: { executor: { select: { userId: true } }, request: { select: { clientId: true } } } } } },
    executorProfile: { select: { userId: true } },
    handSignature: { select: { userId: true } },
    bankDocFor: { select: { id: true } },
  } as const satisfies Prisma.StoredFileSelect;
}

type LoadedOwners = Prisma.StoredFileGetPayload<{ select: ReturnType<typeof ownersSelect> }>;

async function loadFacts(fileId: string, executorId: string | undefined): Promise<FileFacts | null> {
  const f = await db.storedFile.findUnique({ where: { id: fileId }, select: ownersSelect(executorId) });
  return f && { uploadedById: f.uploadedById, owner: ownerOf(f) };
}

/**
 * Кто читает файл по его владельцу (оператор — всегда, см. decideFileAccess):
 * фото сдачи, «Ход работ», спор, документ сделки, вложение чата — стороны; KYC — сам мастер;
 * рисунок подписи — подписавший (другая сторона видит его в PDF документа); скан банковского
 * документа — только оператор: в платёжке реквизиты счёта мастера и банка, стороны видят номер и
 * дату документа в истории денег и в выписке (MONEY_STATEMENT).
 */
function ownerOf(f: LoadedOwners): FileFacts["owner"] {
  if (f.portfolioItem) return { kind: "portfolio", published: f.portfolioItem.published, ownerUserId: f.portfolioItem.executor.userId };
  const request = f.request ?? f.visualization?.request;
  if (request) {
    const { offers, ...rest } = request;
    return { kind: "request", request: { ...rest, viewerHasOffer: offers.length > 0 } };
  }
  const deal = f.deal ?? f.progressReport?.deal ?? f.dispute?.deal ?? f.document?.deal;
  if (deal) return { kind: "parties", userIds: partiesOf(deal) };
  if (f.message) return { kind: "parties", userIds: [f.message.offer.request.clientId, f.message.offer.executor.userId] };
  const own = f.executorProfile ?? f.handSignature;
  if (own) return { kind: "parties", userIds: [own.userId] };
  if (f.bankDocFor) return { kind: "parties", userIds: [] };
  return { kind: "none" };
}

async function viewerOf(user: CurrentUser | null): Promise<Viewer> {
  if (!user) return null;
  if (!user.executor) return { id: user.id, role: user.role, executor: null };
  const profile = await db.executorProfile.findUnique({ where: { id: user.executor.id }, select: { segment: true } });
  return { id: user.id, role: user.role, executor: { id: user.executor.id, status: user.executor.status, segment: profile?.segment ?? null } };
}

/**
 * Права на файл по сущности-владельцу: портфолио — публично; фото помещения — заказчик и исполнители,
 * видящие заявку; фото сдачи, «Ход работ», спор, документ, вложение чата — стороны; KYC — мастер;
 * рисунок подписи — подписавший; скан банковского документа — оператор (ownerOf); оператор — всё;
 * гость — только опубликованное портфолио.
 *
 * Правило для маршрутов «файл по id» без сущности-владельца на руках (ADR-003: право проверяется при
 * выдаче ссылки). Сервисы, которые сейчас выдают fileUrl, уже проверяют доступ к своей сущности и
 * сюда не ходят: фото помещения — requests (loadOwnRequest / visibleToExecutor), сдачи и «Хода работ» — deal-core
 * (loadView: сторона или оператор), спора — operator (assertOperator), визуализации — ai
 * (readableRequest), портфолио — companies (опубликовано или своё). Вложения чата отдаются только id.
 */
export async function canReadFile(user: CurrentUser | null, file: { id: string }): Promise<boolean> {
  const facts = await loadFacts(file.id, user?.executor?.id);
  if (!facts) return false;
  return decideFileAccess(await viewerOf(user), facts);
}
