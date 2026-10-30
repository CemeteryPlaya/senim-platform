import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex } from "@/platform/crypto";
import { transaction } from "@/platform/db";
import { createContract } from "@/modules/documents";
import { startSession } from "@/modules/identity";
import { makeClient, makeOperator } from "../../../../../../test/factories";
import { makeDeal } from "../../../../../../test/factories/documents";
import { freshBrowser, setEnv } from "../../../../../../test/factories/identity";
import { GET } from "./route";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

let storageDir: string;
beforeAll(async () => {
  storageDir = await mkdtemp(path.join(os.tmpdir(), "senim-documents-route-"));
  setEnv({ STORAGE_PROVIDER: "local", STORAGE_LOCAL_DIR: storageDir, SIGNATURE_PROVIDER: "mock" });
});
afterAll(() => rm(storageDir, { recursive: true, force: true }));
beforeEach(() => freshBrowser());

const call = (id: string) => GET(new Request(`http://localhost/api/documents/${id}/pdf`), { params: Promise.resolve({ id }) });

describe("GET /api/documents/[id]/pdf", () => {
  it("сторона сделки получает PDF с хэшем документа", async () => {
    const { deal, client } = await makeDeal();
    const { documentId, sha256 } = await transaction((tx) => createContract(tx, deal.id));
    await startSession(client.id);

    const res = await call(documentId);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(res.headers.get("x-document-sha256")).toBe(sha256);
    expect(res.headers.get("content-disposition")).toMatch(/^inline; filename="document\.pdf"; filename\*=UTF-8''/);
    expect(sha256Hex(new Uint8Array(await res.arrayBuffer()))).toBe(sha256);
  });

  it("оператор видит, чужой — 404, без входа — 401", async () => {
    const { deal } = await makeDeal();
    const { documentId } = await transaction((tx) => createContract(tx, deal.id));

    expect((await call(documentId)).status).toBe(401);

    await startSession((await makeClient()).id);
    expect((await call(documentId)).status).toBe(404);

    freshBrowser();
    await startSession((await makeOperator()).id);
    expect((await call(documentId)).status).toBe(200);
  });
});
