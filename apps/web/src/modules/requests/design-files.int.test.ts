import { describe, expect, it } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../test/factories";
import { makeOpenRequest } from "../../../test/factories/requests";
import { getIncomingRequest, getRequestDesignFiles, setRequestFileHidden } from "./index";

const code = (code: string) => expect.objectContaining({ code });

let n = 0;
const file = (requestId: string, uploadedById: string, opts: { purpose?: FilePurpose; contentType?: string; sortOrder?: number } = {}) =>
  db.storedFile.create({
    data: {
      storageKey: `test/operator-design-${++n}-${Date.now()}`,
      provider: "local",
      purpose: opts.purpose ?? "REQUEST_DESIGN",
      contentType: opts.contentType ?? "application/pdf",
      size: 1,
      sha256: "x",
      uploadedById,
      requestId,
      sortOrder: opts.sortOrder ?? 0,
    },
  });

async function setup() {
  const client = await makeClient();
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const { number } = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { number: true } });
  return { client, requestId, number, operator: await makeOperator() };
}

const auditCount = (requestId: string, action: string) => db.auditEvent.count({ where: { entityType: "request", entityId: requestId, action } });

describe("оператор: файлы дизайн-проекта заявки", () => {
  it("видит все файлы по порядку, скрытый — с пометкой hidden", async () => {
    const { client, requestId, number, operator } = await setup();
    const pdf = await file(requestId, client.id, { sortOrder: 0 });
    const photo = await file(requestId, client.id, { contentType: "image/jpeg", sortOrder: 1 });
    await file(requestId, client.id, { purpose: "REQUEST_ROOM", contentType: "image/jpeg" });
    await setRequestFileHidden(operator, { fileId: photo.id, hidden: true });

    const r = await getRequestDesignFiles(operator, number);
    expect(r).toMatchObject({ requestId, number });
    expect(r.files.map((f) => [f.id, f.kind, f.n, f.hidden])).toEqual([
      [pdf.id, "pdf", 1, false],
      [photo.id, "image", 2, true],
    ]);
  });

  it("заявки с таким номером нет — NOT_FOUND", async () => {
    const operator = await makeOperator();
    await expect(getRequestDesignFiles(operator, 2_000_000_000)).rejects.toThrow(code("NOT_FOUND"));
  });

  it("скрытие: hiddenAt и оператор записаны, одна запись аудита; повтор — changed:false без второй записи", async () => {
    const { client, requestId, operator } = await setup();
    const pdf = await file(requestId, client.id);

    expect(await setRequestFileHidden(operator, { fileId: pdf.id, hidden: true })).toEqual({ changed: true });
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } });
    expect(row.hiddenAt).toBeInstanceOf(Date);
    expect(row.hiddenById).toBe(operator.id);
    expect(await auditCount(requestId, "request.design_file_hidden")).toBe(1);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { entityId: requestId, action: "request.design_file_hidden" } });
    expect(audit).toMatchObject({ actorId: operator.id, actorRole: "OPERATOR", meta: { fileId: pdf.id } });

    expect(await setRequestFileHidden(operator, { fileId: pdf.id, hidden: true })).toEqual({ changed: false });
    expect(await auditCount(requestId, "request.design_file_hidden")).toBe(1);
  });

  it("одновременные нажатия «Скрыть» дают один эффект и одну запись аудита", async () => {
    const { client, requestId, operator } = await setup();
    const pdf = await file(requestId, client.id);
    const results = await Promise.all([1, 2, 3].map(() => setRequestFileHidden(operator, { fileId: pdf.id, hidden: true })));
    expect(results.filter((r) => r.changed)).toHaveLength(1);
    expect(await auditCount(requestId, "request.design_file_hidden")).toBe(1);
  });

  it("возврат: файл снова виден мастеру, запись аудита; повтор возврата — без эффекта", async () => {
    const { client, requestId, operator } = await setup();
    const master = await makeExecutor({ segment: "COMFORT" });
    const pdf = await file(requestId, client.id);

    await setRequestFileHidden(operator, { fileId: pdf.id, hidden: true });
    expect((await getIncomingRequest(master, requestId)).design).toEqual([]);

    expect(await setRequestFileHidden(operator, { fileId: pdf.id, hidden: false })).toEqual({ changed: true });
    const row = await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } });
    expect(row.hiddenAt).toBeNull();
    expect(row.hiddenById).toBeNull();
    expect((await getIncomingRequest(master, requestId)).design.map((f) => f.id)).toEqual([pdf.id]);
    expect(await auditCount(requestId, "request.design_file_restored")).toBe(1);

    expect(await setRequestFileHidden(operator, { fileId: pdf.id, hidden: false })).toEqual({ changed: false });
    expect(await auditCount(requestId, "request.design_file_restored")).toBe(1);
  });

  it("покупатель и мастер — FORBIDDEN, файл не меняется", async () => {
    const { client, requestId, number } = await setup();
    const master = await makeExecutor({ segment: "COMFORT" });
    const pdf = await file(requestId, client.id);
    for (const user of [client, master]) {
      await expect(setRequestFileHidden(user, { fileId: pdf.id, hidden: true })).rejects.toThrow(code("FORBIDDEN"));
      await expect(getRequestDesignFiles(user, number)).rejects.toThrow(code("FORBIDDEN"));
    }
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } })).hiddenAt).toBeNull();
  });

  it("фото помещения (REQUEST_ROOM) и неизвестный файл — NOT_FOUND, ничего не меняется и не пишется", async () => {
    const { client, requestId, operator } = await setup();
    const room = await file(requestId, client.id, { purpose: "REQUEST_ROOM", contentType: "image/jpeg" });
    await expect(setRequestFileHidden(operator, { fileId: room.id, hidden: true })).rejects.toThrow(code("NOT_FOUND"));
    await expect(setRequestFileHidden(operator, { fileId: "net-takogo", hidden: true })).rejects.toThrow(code("NOT_FOUND"));
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: room.id } })).hiddenAt).toBeNull();
    expect(await auditCount(requestId, "request.design_file_hidden")).toBe(0);
  });
});
