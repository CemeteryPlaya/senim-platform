import { describe, expect, it } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import { runDueJobs } from "@/platform/jobs";
import { db, transaction } from "@/platform/db";
import { isAppError } from "@/platform/errors";
import { makeExecutor, makeOperator } from "../../../test/factories";
import { dealAt, makeDeal } from "../../../test/factories/deal";
import { ORPHAN_AGE_MS } from "./cleanup";
import { assertAttachable, attachFiles, discardUpload, jobHandlers, type FileOwner } from "./index";

let n = 0;
const upload = async (uploadedById: string, purpose: FilePurpose) =>
  (await db.storedFile.create({ data: { storageKey: `t/a${++n}.jpg`, provider: "local", purpose, contentType: "image/jpeg", size: 1, sha256: "x", uploadedById } })).id;

const code = async (p: Promise<unknown>) => {
  const e = await p.catch((err: unknown) => err);
  return isAppError(e) ? e.code : e;
};
const attach = (fileIds: string[], uploadedById: string, owner: FileOwner) => transaction((tx) => attachFiles(tx, { fileIds, uploadedById, owner }));

describe("attachFiles: новые владельцы", () => {
  it("фото сдачи — к сделке, «Ход работ» — к отчёту; порядок списка, догрузка — в конец", async () => {
    const deal = await dealAt("IN_PROGRESS");
    const me = deal.executor.id;
    const [a, b, c] = [await upload(me, "DELIVERY"), await upload(me, "DELIVERY"), await upload(me, "DELIVERY")];
    await attach([b, a], me, { dealId: deal.dealId });
    await attach([c], me, { dealId: deal.dealId });
    const delivered = await db.storedFile.findMany({ where: { dealId: deal.dealId }, orderBy: { sortOrder: "asc" } });
    expect(delivered.map((f) => f.id)).toEqual([b, a, c]);

    const report = await db.progressReport.create({ data: { dealId: deal.dealId, authorId: me, text: "Каркас" } });
    const progress = await upload(me, "PROGRESS_REPORT");
    await attach([progress], me, { progressReportId: report.id });
    expect(await db.storedFile.findUniqueOrThrow({ where: { id: progress } })).toMatchObject({ progressReportId: report.id });
  });

  it("назначение должно совпасть с владельцем: «Ход работ» не прикрепить как сдачу и наоборот", async () => {
    const deal = await dealAt("IN_PROGRESS");
    const me = deal.executor.id;
    const report = await db.progressReport.create({ data: { dealId: deal.dealId, authorId: me } });
    expect(await code(attach([await upload(me, "PROGRESS_REPORT")], me, { dealId: deal.dealId }))).toBe("CONFLICT");
    expect(await code(attach([await upload(me, "DELIVERY")], me, { progressReportId: report.id }))).toBe("CONFLICT");
  });

  it("чужое фото не прикрепить к своей сделке (IDOR), и откатывается вся пачка", async () => {
    const deal = await dealAt("IN_PROGRESS");
    const other = await makeExecutor();
    const mine = await upload(deal.executor.id, "DELIVERY");
    const theirs = await upload(other.id, "DELIVERY");
    expect(await code(attach([mine, theirs], deal.executor.id, { dealId: deal.dealId }))).toBe("CONFLICT");
    expect(await db.storedFile.count({ where: { dealId: deal.dealId } })).toBe(0);
  });

  it("KYC: удостоверение и свидетельство ИП — в профиль; фото портфолио туда нельзя; прикреплённое — не второй раз", async () => {
    const executor = await makeExecutor();
    const profile = { executorProfileId: executor.executor.id };
    const id = await upload(executor.id, "KYC_ID");
    const registration = await upload(executor.id, "KYC_REGISTRATION");
    await attach([id, registration], executor.id, profile);
    expect(await db.storedFile.count({ where: profile })).toBe(2);
    expect(await code(attach([await upload(executor.id, "PORTFOLIO")], executor.id, profile))).toBe("CONFLICT");
    const another = await makeExecutor();
    expect(await code(attach([id], executor.id, { executorProfileId: another.executor.id }))).toBe("CONFLICT");
  });

  it("KYC: с назначением — только файлы этого назначения (удостоверение не сойдёт за свидетельство)", async () => {
    const executor = await makeExecutor();
    const owner = { executorProfileId: executor.executor.id };
    const id = await upload(executor.id, "KYC_ID");
    const narrow = (fileIds: string[], purpose: "KYC_ID" | "KYC_REGISTRATION") => code(transaction((tx) => attachFiles(tx, { fileIds, uploadedById: executor.id, owner, purpose })));
    expect(await narrow([id], "KYC_REGISTRATION")).toBe("CONFLICT");
    expect(await narrow([id], "KYC_ID")).toBeUndefined();
    expect(await db.storedFile.count({ where: owner })).toBe(1);
  });
});

describe("assertAttachable: файлы, на которые ссылаются с другой стороны", () => {
  it("скан банковского документа: свой и свободный — да; чужой оператор, другое назначение, уже приложенный — CONFLICT", async () => {
    const operator = await makeOperator();
    const colleague = await makeOperator();
    const scan = await upload(operator.id, "BANK_DOCUMENT");
    const check = (fileId: string, uploadedById = operator.id) =>
      transaction((tx) => assertAttachable(tx, { fileId, uploadedById, purpose: "BANK_DOCUMENT" }));

    await expect(check(scan)).resolves.toBeUndefined();
    expect(await code(check(scan, colleague.id))).toBe("CONFLICT");
    expect(await code(check(await upload(operator.id, "DOCUMENT")))).toBe("CONFLICT");

    const deal = await dealAt("PAID_HOLD", { provider: "manual" });
    const used = (await db.moneyTransaction.findFirstOrThrow({ where: { dealId: deal.dealId, type: "HOLD" } })).bankDocFileId!;
    const usedBy = (await db.storedFile.findUniqueOrThrow({ where: { id: used } })).uploadedById!;
    expect(await code(check(used, usedBy))).toBe("CONFLICT");
  });

  it("рисунок подписи: свой — да, чужой — нет; привязанный к подписи — больше не свободен", async () => {
    const deal = await makeDeal();
    const image = await upload(deal.client.id, "HAND_SIGNATURE");
    const check = (uploadedById: string) => transaction((tx) => assertAttachable(tx, { fileId: image, uploadedById, purpose: "HAND_SIGNATURE" }));
    await expect(check(deal.client.id)).resolves.toBeUndefined();
    expect(await code(check(deal.executor.id))).toBe("CONFLICT");

    const contract = await db.document.findFirstOrThrow({ where: { dealId: deal.dealId, kind: "CONTRACT" } });
    await db.handSignature.create({ data: { documentId: contract.id, userId: deal.client.id, party: "CLIENT", imageFileId: image, documentSha256: contract.sha256 } });
    expect(await code(check(deal.client.id))).toBe("CONFLICT");
  });

  it("привязанные с другой стороны файлы не удаляются: ни пользователем, ни уборкой сирот", async () => {
    const deal = await dealAt("PAID_HOLD", { provider: "manual" });
    const scan = (await db.moneyTransaction.findFirstOrThrow({ where: { dealId: deal.dealId, type: "HOLD" } })).bankDocFileId!;
    const file = await db.storedFile.update({ where: { id: scan }, data: { createdAt: new Date(Date.now() - ORPHAN_AGE_MS - 60_000) } });
    const operator = await db.user.findUniqueOrThrow({ where: { id: file.uploadedById! } });

    expect(await code(discardUpload({ id: operator.id, role: "OPERATOR", roles: ["OPERATOR"], phone: operator.phone, fullName: null, iinLast4: null, isDemo: false, executor: null }, scan))).toBe("CONFLICT");
    await db.job.create({ data: { kind: "files.cleanupOrphans" } });
    await runDueJobs(jobHandlers);
    expect(await db.storedFile.findUnique({ where: { id: scan } })).not.toBeNull();
  });
});
