import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/platform/crypto";
import { makeClient, makeOperator } from "../../../../../../test/factories";
import { makeDeal } from "../../../../../../test/factories/deal";
import { latestDocument, signTyped, useDocuments } from "../../../../../../test/factories/documents";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import { GET } from "./route";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());
beforeEach(() => freshBrowser());

const call = (id: string, query = "") => GET(new Request(`http://localhost/api/documents/${id}/pdf${query}`), { params: Promise.resolve({ id }) });

describe("GET /api/documents/[id]/pdf", () => {
  it("сторона сделки: подписанная копия по умолчанию, исходный файл с хэшем документа по ?original=1, скачивание по ?download=1", async () => {
    const f = await makeDeal();
    const { id, sha256 } = await latestDocument(f.dealId, "CONTRACT");
    await signInAs(f.client);
    await signTyped(f.client, id);

    const original = await call(id, "?original=1");
    expect(original.status).toBe(200);
    expect(original.headers.get("content-type")).toBe("application/pdf");
    expect(original.headers.get("cache-control")).toContain("no-store");
    expect(original.headers.get("x-document-sha256")).toBe(sha256);
    expect(original.headers.get("content-disposition")).toMatch(/^inline; filename="document\.pdf"; filename\*=UTF-8''/);
    expect(sha256Hex(new Uint8Array(await original.arrayBuffer()))).toBe(sha256);

    const signed = await call(id);
    expect(sha256Hex(new Uint8Array(await signed.arrayBuffer()))).not.toBe(sha256);
    expect((await call(id, "?download=1")).headers.get("content-disposition")).toMatch(/^attachment;/);
  });

  it("оператор видит, чужой — 404, без входа — 401", async () => {
    const f = await makeDeal();
    const { id } = await latestDocument(f.dealId, "CONTRACT");

    expect((await call(id)).status).toBe(401);

    await signInAs(await makeClient());
    expect((await call(id)).status).toBe(404);

    freshBrowser();
    await signInAs(await makeOperator());
    expect((await call(id)).status).toBe(200);
  });
});
