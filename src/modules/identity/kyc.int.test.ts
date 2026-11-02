import { describe, expect, it } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { getOwnKyc, kycQueue, reviewKyc, submitKycDocuments } from "./kyc";

/** KYC мастера (решение 2.2.8): документы через files, решение оператора с журналом и уведомлением. */
const code = (p: Promise<unknown>) => p.then(() => "OK", (e: { code?: string }) => e.code ?? String(e));

let n = 0;
async function upload(user: CurrentUser, purpose: FilePurpose) {
  n += 1;
  const file = await db.storedFile.create({
    data: { storageKey: `kyc/test/${n}.jpg`, provider: "local", purpose, contentType: "image/jpeg", size: 1000, sha256: "3".repeat(64), uploadedById: user.id },
  });
  return file.id;
}

async function submitted() {
  const executor = await makeExecutor({ legalName: "ИП «Дала»" });
  const files = { idFileIds: [await upload(executor, "KYC_ID")], registrationFileIds: [await upload(executor, "KYC_REGISTRATION")] };
  await submitKycDocuments(executor, files);
  return { executor, files, executorId: executor.executor.id };
}

const kycAudit = (executorId: string) =>
  db.auditEvent.findMany({ where: { entityId: executorId, action: { startsWith: "executor.kyc_" } }, orderBy: { createdAt: "asc" } });

describe("мастер загружает документы", () => {
  it("документы прикрепляются к профилю, статус — на проверке, операторы получают уведомление", async () => {
    const operator = await makeOperator();
    const executor = await makeExecutor();
    expect(await getOwnKyc(executor)).toMatchObject({ state: "NOT_SUBMITTED", canSubmit: true, documents: { id: 0, registration: 0 } });

    const idFileIds = [await upload(executor, "KYC_ID"), await upload(executor, "KYC_ID")];
    const registrationFileIds = [await upload(executor, "KYC_REGISTRATION")];
    await submitKycDocuments(executor, { idFileIds, registrationFileIds });

    expect(await getOwnKyc(executor)).toEqual({ state: "PENDING", canSubmit: true, rejectReason: null, documents: { id: 2, registration: 1 } });
    const attached = await db.storedFile.findMany({ where: { executorProfileId: executor.executor.id } });
    expect(attached.map((f) => f.id).sort()).toEqual([...idFileIds, ...registrationFileIds].sort());
    expect(await db.notification.count({ where: { userId: operator.id, kind: "kyc.submitted" } })).toBe(1);
    expect((await kycAudit(executor.executor.id)).map((e) => e.action)).toEqual(["executor.kyc_submitted"]);
  });

  it("без удостоверения или без регистрации — VALIDATION", async () => {
    const executor = await makeExecutor();
    const id = await upload(executor, "KYC_ID");
    expect(await code(submitKycDocuments(executor, { idFileIds: [id], registrationFileIds: [] }))).toBe("VALIDATION");
    expect(await code(submitKycDocuments(executor, { idFileIds: [], registrationFileIds: [await upload(executor, "KYC_REGISTRATION")] }))).toBe("VALIDATION");
  });

  it("чужой файл, файл не того назначения или уже прикреплённый — отказ, ничего не прикрепляется", async () => {
    const executor = await makeExecutor();
    const stranger = await makeExecutor();
    const reg = await upload(executor, "KYC_REGISTRATION");
    const cases = [
      { idFileIds: [await upload(stranger, "KYC_ID")], registrationFileIds: [reg] },
      { idFileIds: [await upload(executor, "KYC_REGISTRATION")], registrationFileIds: [reg] },
      { idFileIds: [await upload(executor, "PORTFOLIO")], registrationFileIds: [reg] },
    ];
    for (const input of cases) expect(await code(submitKycDocuments(executor, input))).not.toBe("OK");
    expect(await db.storedFile.count({ where: { executorProfileId: executor.executor.id } })).toBe(0);

    const { executor: other, files } = await submitted();
    expect(await code(submitKycDocuments(other, files))).not.toBe("OK");
  });

  it("заказчик и оператор документы мастера не загружают — FORBIDDEN", async () => {
    for (const user of [await makeClient(), await makeOperator()]) {
      expect(await code(submitKycDocuments(user, { idFileIds: ["x"], registrationFileIds: ["y"] }))).toBe("FORBIDDEN");
      expect(await code(getOwnKyc(user))).toBe("FORBIDDEN");
    }
  });
});

describe("оператор проверяет документы", () => {
  it("очередь — только мастера с документами на проверке; ссылки на файлы готовы", async () => {
    const operator = await makeOperator();
    const { executorId, files } = await submitted();
    await makeExecutor(); // без документов — в очереди его нет
    const queue = await kycQueue(operator);
    expect(queue.map((q) => q.executorId)).toEqual([executorId]);
    expect(queue[0]).toMatchObject({ legalName: "ИП «Дала»", publicNumber: expect.any(Number), binIinLast4: expect.any(String) });
    expect(queue[0]!.documents.map((d) => [d.id, d.purpose]).sort()).toEqual(
      [
        [files.idFileIds[0], "KYC_ID"],
        [files.registrationFileIds[0], "KYC_REGISTRATION"],
      ].sort(),
    );
    expect(queue[0]!.documents.every((d) => d.url.length > 0)).toBe(true);
  });

  it("подтвердил — VERIFIED, журнал и уведомление мастеру; из очереди уходит; повтор — CONFLICT без второй записи", async () => {
    const operator = await makeOperator();
    const { executor, executorId } = await submitted();
    await reviewKyc(operator, { executorId, decision: "VERIFIED" });

    const row = await db.executorProfile.findUniqueOrThrow({ where: { id: executorId } });
    expect(row).toMatchObject({ kycStatus: "VERIFIED", kycRejectReason: null, kycReviewedAt: expect.any(Date) });
    expect(await db.notification.count({ where: { userId: executor.id, kind: "kyc.verified" } })).toBe(1);
    expect(await kycQueue(operator)).toEqual([]);
    expect(await code(reviewKyc(operator, { executorId, decision: "VERIFIED" }))).toBe("CONFLICT");
    expect((await kycAudit(executorId)).map((e) => [e.action, e.before, e.after])).toEqual([
      ["executor.kyc_submitted", { status: "PENDING" }, { status: "PENDING" }],
      ["executor.kyc_verified", { status: "PENDING" }, { status: "VERIFIED" }],
    ]);
    // Проверенные документы мастер не заменяет.
    const files = { idFileIds: [await upload(executor, "KYC_ID")], registrationFileIds: [await upload(executor, "KYC_REGISTRATION")] };
    expect(await code(submitKycDocuments(executor, files))).toBe("CONFLICT");
  });

  it("одновременные решения двух операторов — ровно одно", async () => {
    const [a, b] = [await makeOperator(), await makeOperator()];
    const { executorId } = await submitted();
    const results = await Promise.all([
      code(reviewKyc(a, { executorId, decision: "VERIFIED" })),
      code(reviewKyc(b, { executorId, decision: "REJECTED", reason: "Фото нечитаемое" })),
    ]);
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await kycAudit(executorId)).filter((e) => e.action !== "executor.kyc_submitted")).toHaveLength(1);
  });

  it("отказ — с причиной; мастер видит причину, загружает заново — снова на проверке, причина снята", async () => {
    const operator = await makeOperator();
    const { executor, executorId } = await submitted();
    expect(await code(reviewKyc(operator, { executorId, decision: "REJECTED" }))).toBe("VALIDATION");
    expect(await code(reviewKyc(operator, { executorId, decision: "REJECTED", reason: " " }))).toBe("VALIDATION");

    await reviewKyc(operator, { executorId, decision: "REJECTED", reason: "Фото удостоверения нечитаемое" });
    expect(await getOwnKyc(executor)).toMatchObject({ state: "REJECTED", canSubmit: true, rejectReason: "Фото удостоверения нечитаемое" });
    expect(await db.notification.count({ where: { userId: executor.id, kind: "kyc.rejected" } })).toBe(1);

    await submitKycDocuments(executor, { idFileIds: [await upload(executor, "KYC_ID")], registrationFileIds: [await upload(executor, "KYC_REGISTRATION")] });
    expect(await getOwnKyc(executor)).toMatchObject({ state: "PENDING", rejectReason: null });
    expect((await kycQueue(operator)).map((q) => q.executorId)).toEqual([executorId]);
  });

  it("без документов решать нечего — CONFLICT; несуществующий мастер — NOT_FOUND; не оператор — FORBIDDEN", async () => {
    const operator = await makeOperator();
    const bare = await makeExecutor();
    expect(await code(reviewKyc(operator, { executorId: bare.executor.id, decision: "VERIFIED" }))).toBe("CONFLICT");
    expect(await code(reviewKyc(operator, { executorId: "no-such", decision: "VERIFIED" }))).toBe("NOT_FOUND");
    const { executor, executorId } = await submitted();
    expect(await code(reviewKyc(executor, { executorId, decision: "VERIFIED" }))).toBe("FORBIDDEN");
    expect(await code(reviewKyc(await makeClient(), { executorId, decision: "VERIFIED" }))).toBe("FORBIDDEN");
    expect(await code(kycQueue(executor))).toBe("FORBIDDEN");
  });
});
