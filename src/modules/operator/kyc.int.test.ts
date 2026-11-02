import { describe, expect, it } from "vitest";
import { db } from "@/platform/db";
import { makeExecutor, makeOperator } from "../../../test/factories";
import { kycQueue, reviewKyc } from "./kyc";

async function executorWithDocs() {
  const executor = await makeExecutor();
  for (const purpose of ["KYC_ID", "KYC_REGISTRATION"] as const) {
    await db.storedFile.create({
      data: {
        storageKey: `test/${purpose}/${executor.executor.id}.jpg`,
        provider: "local",
        purpose,
        contentType: "image/jpeg",
        size: 1024,
        sha256: "0".repeat(64),
        uploadedById: executor.id,
        executorProfileId: executor.executor.id,
      },
    });
  }
  return executor;
}

describe("KYC мастеров", () => {
  it("очередь: только мастера с документами на проверке, документы со ссылками", async () => {
    const operator = await makeOperator();
    const withDocs = await executorWithDocs();
    await makeExecutor(); // без документов — не в очереди

    const queue = await kycQueue(operator);

    expect(queue).toHaveLength(1);
    expect(queue[0]).toMatchObject({ profileId: withDocs.executor.id, kycStatus: "PENDING" });
    expect(queue[0].documents.map((d) => d.purpose)).toEqual(["KYC_ID", "KYC_REGISTRATION"]);
    expect(queue[0].documents[0].url).toEqual(expect.any(String));
  });

  it("подтверждение: VERIFIED, аудит до и после, уведомление мастеру; повтор — CONFLICT", async () => {
    const operator = await makeOperator();
    const executor = await executorWithDocs();

    await reviewKyc(operator, { profileId: executor.executor.id, decision: "VERIFIED" });

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toMatchObject({ kycStatus: "VERIFIED", kycRejectReason: null });
    expect(await db.auditEvent.findFirstOrThrow({ where: { action: "executor.kyc.verified" } })).toMatchObject({
      actorId: operator.id,
      scope: `executor:${executor.executor.id}`,
      before: { kycStatus: "PENDING" },
      after: { kycStatus: "VERIFIED" },
    });
    expect(await db.notification.count({ where: { userId: executor.id, kind: "executor.kyc.verified" } })).toBe(1);
    await expect(reviewKyc(operator, { profileId: executor.executor.id, decision: "VERIFIED" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await kycQueue(operator)).toEqual([]);
  });

  it("отклонение — с причиной, которую видит мастер", async () => {
    const operator = await makeOperator();
    const executor = await executorWithDocs();

    await reviewKyc(operator, { profileId: executor.executor.id, decision: "REJECTED", reason: "Фото удостоверения нечитаемо" });

    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toMatchObject({
      kycStatus: "REJECTED",
      kycRejectReason: "Фото удостоверения нечитаемо",
    });
    const note = await db.notification.findFirstOrThrow({ where: { userId: executor.id, kind: "executor.kyc.rejected" } });
    expect(note.body).toContain("Фото удостоверения нечитаемо");
  });
});
