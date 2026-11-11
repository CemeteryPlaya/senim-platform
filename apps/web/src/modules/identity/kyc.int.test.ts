import { beforeEach, describe, expect, it, vi } from "vitest";
import { KycStatus } from "@/gen/senim/identity/v1/identity_pb";
import type { FilePurpose } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { asBrowser, freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { getOwnKyc, kycQueue, kycQueueCount, reviewKyc, submitKycDocuments } from "./kyc";
import { sessionCookieName } from "./session-cookie";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

/**
 * KYC мастера (решение 2.2.8) через identity: файлы проверяет и прикрепляет web, статус и переходы — identity (SubmitKyc,
 * ListKycQueue, ReviewKyc), проекция — в ExecutorProfile, уведомления — web. Выдача ссылки на документ — аудит web.
 */
const t = ru.identity.kyc;
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));
const message = (p: Promise<unknown>) => p.then(() => "OK", (e: Error) => e.message);
const calls = (method: string) => identityFake.calls.filter((c) => c.method === method);
const kycAudit = (userId: string) => identityFake.auditEvents.filter((e) => e.userId === userId && e.action.startsWith("executor.kyc_"));

const sessions = new Map<string, Promise<string>>();
beforeEach(() => {
  freshBrowser();
  sessions.clear();
});

/** Действие от лица вошедшего человека: своя сессия identity и свой «браузер» (одновременные действия не путают токены). */
async function as<T>(user: { id: string }, call: () => Promise<T>, opts: { mfaVerifiedAt?: Date | null } = {}): Promise<T> {
  let signedIn = sessions.get(user.id);
  if (signedIn === undefined) {
    signedIn = signInAs(user, undefined, opts);
    sessions.set(user.id, signedIn);
  }
  const token = await signedIn;
  return asBrowser({ [sessionCookieName()]: token }, call);
}

let n = 0;
async function upload(user: CurrentUser, purpose: FilePurpose) {
  n += 1;
  const file = await db.storedFile.create({
    data: { storageKey: `kyc/test/${n}.jpg`, provider: "local", purpose, contentType: "image/jpeg", size: 1000, sha256: "3".repeat(64), uploadedById: user.id },
  });
  return file.id;
}

const freshFiles = async (executor: CurrentUser) => ({
  idFileIds: [await upload(executor, "KYC_ID")],
  registrationFileIds: [await upload(executor, "KYC_REGISTRATION")],
});

async function submitted() {
  const executor = await makeExecutor({ legalName: "ИП «Дала»" });
  const files = await freshFiles(executor);
  await as(executor, () => submitKycDocuments(executor, files));
  return { executor, files, executorId: executor.executor.id };
}

const own = (executor: CurrentUser) => as(executor, () => getOwnKyc(executor));
const queueOf = (operator: CurrentUser) => as(operator, () => kycQueue(operator));
const review = (operator: CurrentUser, userId: string, decision: Parameters<typeof reviewKyc>[2]) => as(operator, () => reviewKyc(operator, userId, decision));

describe("мастер загружает документы", () => {
  it("файлы прикрепляются к профилю в web, их id уходят в identity; статус — на проверке, операторы получают уведомление", async () => {
    const operator = await makeOperator();
    const executor = await makeExecutor();
    expect(await own(executor)).toMatchObject({ state: "NOT_SUBMITTED", canSubmit: true, documents: { id: 0, registration: 0 } });

    const idFileIds = [await upload(executor, "KYC_ID"), await upload(executor, "KYC_ID")];
    const registrationFileIds = [await upload(executor, "KYC_REGISTRATION")];
    await as(executor, () => submitKycDocuments(executor, { idFileIds, registrationFileIds }));

    expect(calls("submitKyc")[0]?.request).toMatchObject({ idFileIds, registrationFileIds, idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(identityFake.partyOf(executor.id)).toMatchObject({ kycStatus: KycStatus.PENDING, kycIdFileIds: idFileIds, kycRegistrationFileIds: registrationFileIds });
    expect(await own(executor)).toEqual({ state: "PENDING", canSubmit: true, rejectReason: null, documents: { id: 2, registration: 1 } });
    const attached = await db.storedFile.findMany({ where: { executorProfileId: executor.executor.id } });
    expect(attached.map((f) => f.id).sort()).toEqual([...idFileIds, ...registrationFileIds].sort());
    expect(await db.notification.count({ where: { userId: operator.id, kind: "kyc.submitted" } })).toBe(1);
    // Журнал подачи ведёт identity (без значений); web своей записи не пишет.
    expect(kycAudit(executor.id).map((e) => [e.action, e.before, e.after])).toEqual([
      ["executor.kyc_submitted", { status: "NOT_SUBMITTED" }, { status: "PENDING", id_files: 2, registration_files: 1 }],
    ]);
    expect(await db.auditEvent.count({ where: { action: { startsWith: "executor.kyc_" } } })).toBe(0);
  });

  it("без удостоверения или без регистрации — VALIDATION, identity не вызывается", async () => {
    const executor = await makeExecutor();
    const id = await upload(executor, "KYC_ID");
    expect(await code(as(executor, () => submitKycDocuments(executor, { idFileIds: [id], registrationFileIds: [] })))).toBe("VALIDATION");
    const reg = await upload(executor, "KYC_REGISTRATION");
    expect(await code(as(executor, () => submitKycDocuments(executor, { idFileIds: [], registrationFileIds: [reg] })))).toBe("VALIDATION");
    expect(calls("submitKyc")).toHaveLength(0);
  });

  it("чужой файл, файл не того назначения или уже прикреплённый — отказ в web, identity не вызывается, ничего не прикрепляется", async () => {
    const executor = await makeExecutor();
    const stranger = await makeExecutor();
    const reg = await upload(executor, "KYC_REGISTRATION");
    const cases = [
      { idFileIds: [await upload(stranger, "KYC_ID")], registrationFileIds: [reg] },
      { idFileIds: [await upload(executor, "KYC_REGISTRATION")], registrationFileIds: [reg] },
      { idFileIds: [await upload(executor, "PORTFOLIO")], registrationFileIds: [reg] },
    ];
    for (const input of cases) expect(await code(as(executor, () => submitKycDocuments(executor, input)))).toBe("CONFLICT");
    expect(await db.storedFile.count({ where: { executorProfileId: executor.executor.id } })).toBe(0);
    expect(calls("submitKyc")).toHaveLength(0);

    const { executor: other, files } = await submitted();
    expect(await code(as(other, () => submitKycDocuments(other, files)))).toBe("CONFLICT");
    expect(calls("submitKyc")).toHaveLength(1);
  });

  it("заказчик и оператор документы мастера не загружают — FORBIDDEN", async () => {
    for (const user of [await makeClient(), await makeOperator()]) {
      expect(await code(as(user, () => submitKycDocuments(user, { idFileIds: ["x"], registrationFileIds: ["y"] })))).toBe("FORBIDDEN");
      expect(await code(as(user, () => getOwnKyc(user)))).toBe("FORBIDDEN");
    }
  });

  it("проверенные документы не заменяются: kyc_transition_forbidden — текст «уже проверены», файлы снова свободны", async () => {
    const executor = await makeExecutor();
    await own(executor); // сессия и сторона — в identity
    identityFake.setKycStatus(executor.id, KycStatus.VERIFIED);
    const files = await freshFiles(executor);
    expect(await message(as(executor, () => submitKycDocuments(executor, files)))).toBe(t.errors.alreadyVerified);
    // identity отказал — ничего не записал: прикрепление в web откатывается, те же файлы можно отправить снова.
    expect(await db.storedFile.count({ where: { executorProfileId: executor.executor.id } })).toBe(0);
    expect(await db.notification.count({ where: { kind: "kyc.submitted" } })).toBe(0);
  });

  it("обрыв связи после записи в identity: повтор с тем же ключом — одна подача, одно уведомление", async () => {
    const operator = await makeOperator();
    const executor = await makeExecutor();
    const files = await freshFiles(executor);
    await own(executor);
    identityFake.failNextAfterEffect();
    await as(executor, () => submitKycDocuments(executor, files));
    const [first, second] = calls("submitKyc");
    expect(second?.request).toEqual(first?.request);
    expect(kycAudit(executor.id)).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: operator.id, kind: "kyc.submitted" } })).toBe(1);
  });

  it("экран — по статусу identity, а не по проекции: старые прикреплённые файлы при «не подано» не делают «на проверке»", async () => {
    const executor = await makeExecutor();
    // История старой базы: файлы прикреплены к профилю, а в identity документы не поданы.
    await db.storedFile.updateMany({ where: { id: { in: Object.values(await freshFiles(executor)).flat() } }, data: { executorProfileId: executor.executor.id } });
    expect(await own(executor)).toMatchObject({ state: "NOT_SUBMITTED", documents: { id: 0, registration: 0 } });
    identityFake.setKycStatus(executor.id, KycStatus.VERIFIED);
    expect(await own(executor)).toMatchObject({ state: "VERIFIED", canSubmit: false });
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toMatchObject({ kycStatus: "VERIFIED" });
  });
});

describe("оператор проверяет документы", () => {
  it("очередь — из identity: мастера с документами на проверке, ФИО и ссылки на 15 минут; число в панели", async () => {
    const operator = await makeOperator();
    const { executor, executorId, files } = await submitted();
    await makeExecutor(); // без документов — в очереди его нет
    const queue = await queueOf(operator);
    expect(queue.map((q) => [q.executorId, q.userId])).toEqual([[executorId, executor.id]]);
    expect(queue[0]).toMatchObject({ legalName: "ИП «Дала»", publicNumber: expect.any(Number), binIinLast4: expect.any(String), submittedAt: expect.any(Date) });
    expect(queue[0]!.documents.map((d) => [d.id, d.purpose])).toEqual([
      [files.idFileIds[0], "KYC_ID"],
      [files.registrationFileIds[0], "KYC_REGISTRATION"],
    ]);
    expect(queue[0]!.documents.every((d) => d.url.length > 0)).toBe(true);
    expect(await as(operator, () => kycQueueCount(operator))).toBe(1);
  });

  it("каждая выданная ссылка — событие аудита web pii.kyc_file_link_issued без значений; подсчёт для панели ссылок не выдаёт", async () => {
    const operator = await makeOperator();
    const { executorId, files } = await submitted();
    await as(operator, () => kycQueueCount(operator));
    expect(await db.auditEvent.count({ where: { action: "pii.kyc_file_link_issued" } })).toBe(0);

    const queue = await queueOf(operator);
    const events = await db.auditEvent.findMany({ where: { action: "pii.kyc_file_link_issued" }, orderBy: { entityId: "asc" } });
    expect(events.map((e) => [e.actorId, e.actorRole, e.entityType, e.entityId, e.scope]).sort()).toEqual(
      [...files.idFileIds, ...files.registrationFileIds].map((id) => [operator.id, "OPERATOR", "file", id, `executor:${executorId}`]).sort(),
    );
    const text = JSON.stringify(events, (_, v: unknown) => (typeof v === "bigint" ? String(v) : v));
    for (const value of [...queue[0]!.documents.map((d) => d.url), "ИП «Дала»", queue[0]!.binIinLast4]) expect(text).not.toContain(value);
  });

  it("файл, которого нет у профиля в web, ссылкой не выдаётся", async () => {
    const operator = await makeOperator();
    const { executor, files } = await submitted();
    const stray = await upload(executor, "KYC_ID"); // не прикреплён к профилю
    identityFake.setKycStatus(executor.id, KycStatus.PENDING, { files: { id: [...files.idFileIds, stray], registration: files.registrationFileIds } });
    const [item] = await queueOf(operator);
    expect(item!.documents.map((d) => d.id)).not.toContain(stray);
    expect(await db.auditEvent.count({ where: { action: "pii.kyc_file_link_issued", entityId: stray } })).toBe(0);
  });

  it("подтвердил — VERIFIED в identity и проекции, уведомление мастеру; из очереди уходит; повтор — текст kyc_transition_forbidden", async () => {
    const operator = await makeOperator();
    const { executor, executorId } = await submitted();
    await review(operator, executor.id, { decision: "VERIFIED" });

    const row = await db.executorProfile.findUniqueOrThrow({ where: { id: executorId } });
    expect(row).toMatchObject({ kycStatus: "VERIFIED", kycRejectReason: null, kycReviewedAt: expect.any(Date) });
    expect(await db.notification.count({ where: { userId: executor.id, kind: "kyc.verified" } })).toBe(1);
    expect(await queueOf(operator)).toEqual([]);
    const again = review(operator, executor.id, { decision: "VERIFIED" });
    await expect(again).rejects.toMatchObject({ code: "CONFLICT", message: t.errors.reviewed });
    expect(kycAudit(executor.id).map((e) => [e.action, e.before, e.after])).toEqual([
      ["executor.kyc_submitted", { status: "NOT_SUBMITTED" }, { status: "PENDING", id_files: 1, registration_files: 1 }],
      ["executor.kyc_verified", { status: "PENDING" }, { status: "VERIFIED" }],
    ]);
    expect(await db.notification.count({ where: { userId: executor.id, kind: "kyc.verified" } })).toBe(1);
    // Проверенные документы мастер не заменяет.
    expect(await code(as(executor, async () => submitKycDocuments(executor, await freshFiles(executor))))).toBe("CONFLICT");
  });

  it("одновременные решения двух операторов — ровно одно, одно уведомление", async () => {
    const [a, b] = [await makeOperator(), await makeOperator()];
    const { executor } = await submitted();
    const results = await Promise.all([
      code(review(a, executor.id, { decision: "VERIFIED" })),
      code(review(b, executor.id, { decision: "REJECTED", reason: "Фото нечитаемое" })),
    ]);
    expect(results.sort()).toEqual(["CONFLICT", "OK"]);
    expect(kycAudit(executor.id).filter((e) => e.action !== "executor.kyc_submitted")).toHaveLength(1);
    expect(await db.notification.count({ where: { userId: executor.id, kind: { in: ["kyc.verified", "kyc.rejected"] } } })).toBe(1);
  });

  it("отказ — с причиной; мастер видит причину, загружает заново — снова на проверке, причина снята", async () => {
    const operator = await makeOperator();
    const { executor } = await submitted();
    expect(await code(review(operator, executor.id, { decision: "REJECTED" }))).toBe("VALIDATION");
    expect(await code(review(operator, executor.id, { decision: "REJECTED", reason: " " }))).toBe("VALIDATION");
    expect(calls("reviewKyc")).toHaveLength(0);

    await review(operator, executor.id, { decision: "REJECTED", reason: "  Фото удостоверения нечитаемое " });
    expect(calls("reviewKyc")[0]?.request).toMatchObject({ userId: executor.id, verify: false, reason: "Фото удостоверения нечитаемое" });
    expect(await own(executor)).toMatchObject({ state: "REJECTED", canSubmit: true, rejectReason: "Фото удостоверения нечитаемое" });
    const note = await db.notification.findFirstOrThrow({ where: { userId: executor.id, kind: "kyc.rejected" } });
    expect(note.body).toBe(t.notifyExecutor.rejectedBody("Фото удостоверения нечитаемое"));

    await as(executor, async () => submitKycDocuments(executor, await freshFiles(executor)));
    expect(await own(executor)).toMatchObject({ state: "PENDING", rejectReason: null });
    expect((await queueOf(operator)).map((q) => q.userId)).toEqual([executor.id]);
  });

  it("без документов решать нечего — CONFLICT; неизвестный мастер — NOT_FOUND; не оператор — FORBIDDEN; без второй ступени — MFA_REQUIRED", async () => {
    const operator = await makeOperator();
    const bare = await makeExecutor();
    await own(bare);
    expect(await code(review(operator, bare.id, { decision: "VERIFIED" }))).toBe("CONFLICT");
    identityFake.setKycStatus(bare.id, KycStatus.PENDING); // PENDING без файлов (демо-сид) — kyc_documents_missing
    expect(await message(review(operator, bare.id, { decision: "VERIFIED" }))).toBe(t.errors.noDocuments);
    expect(await message(review(operator, "no-such", { decision: "VERIFIED" }))).toBe(t.errors.notFound);
    const { executor } = await submitted();
    expect(await code(as(executor, () => reviewKyc(executor, executor.id, { decision: "VERIFIED" })))).toBe("FORBIDDEN");
    const client = await makeClient();
    expect(await code(as(client, () => reviewKyc(client, executor.id, { decision: "VERIFIED" })))).toBe("FORBIDDEN");
    expect(await code(as(executor, () => kycQueue(executor)))).toBe("FORBIDDEN");

    const smsOnly = await makeOperator();
    const noMfa = <T>(call: () => Promise<T>) => as(smsOnly, call, { mfaVerifiedAt: null });
    expect(await code(noMfa(() => kycQueue(smsOnly)))).toBe("MFA_REQUIRED");
    expect(await code(noMfa(() => reviewKyc(smsOnly, executor.id, { decision: "VERIFIED" })))).toBe("MFA_REQUIRED");
    expect(identityFake.partyOf(executor.id)?.kycStatus).toBe(KycStatus.PENDING);
  });
});
