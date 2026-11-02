import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shareDocument } from "@/modules/documents";
import { sha256Hex } from "@/platform/crypto";
import { makeDeal } from "../../../../../test/factories/deal";
import { latestDocument, useDocuments } from "../../../../../test/factories/documents";
import { GET } from "./route";

let cleanup: () => Promise<void>;
beforeAll(async () => {
  cleanup = await useDocuments();
});
afterAll(() => cleanup());

const call = (token: string, query = "") => GET(new Request(`http://localhost/d/${token}/pdf${query}`), { params: Promise.resolve({ token }) });

describe("GET /d/[token]/pdf — документ по подписанной ссылке", () => {
  it("действующая ссылка отдаёт PDF без входа; подделанная — 404", async () => {
    const f = await makeDeal();
    const { id, sha256 } = await latestDocument(f.dealId, "CONTRACT");
    const token = new URL((await shareDocument(f.client, id)).url).pathname.split("/").at(-1)!;

    const res = await call(token, "?original=1&download=1");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(sha256Hex(new Uint8Array(await res.arrayBuffer()))).toBe(sha256);

    const forged = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    expect((await call(forged)).status).toBe(404);
    expect((await call("cmother.zz.abc")).status).toBe(404);
  });
});
