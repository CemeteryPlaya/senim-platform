import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { LINK_TTL_SEC, openDocumentLink, sealDocumentLink, whatsappShareUrl } from "./links";

const secret = "test-secret";

beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
  vi.stubEnv("FILE_URL_SECRET", "");
  resetEnvCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
const now = Date.UTC(2026, 10, 5, 6);

describe("подписанная ссылка на документ", () => {
  it("открывается до истечения срока и ведёт на тот же документ", () => {
    const { token, expiresAt } = sealDocumentLink("cmdoc123", { now, secret });
    expect(expiresAt.getTime()).toBe(now + LINK_TTL_SEC * 1000);
    expect(openDocumentLink(token, { now: now + 1000, secret })).toEqual({ documentId: "cmdoc123", expiresAt });
  });

  it("после срока, с чужим секретом, с подменённым документом или сроком — не открывается", () => {
    const { token } = sealDocumentLink("cmdoc123", { now, secret });
    expect(openDocumentLink(token, { now: now + LINK_TTL_SEC * 1000 + 1, secret })).toBeNull();
    expect(openDocumentLink(token, { now, secret: "other" })).toBeNull();
    const [, exp, mac] = token.split(".");
    expect(openDocumentLink(`cmdoc999.${exp}.${mac}`, { now, secret })).toBeNull();
    expect(openDocumentLink(`cmdoc123.${(Number.parseInt(exp, 36) + 3600).toString(36)}.${mac}`, { now, secret })).toBeNull();
    expect(openDocumentLink("мусор", { now, secret })).toBeNull();
    expect(openDocumentLink("", { now, secret })).toBeNull();
  });

  it("ссылка неправильной формы не открывается; ровно в момент истечения ещё действует", () => {
    const { token, expiresAt } = sealDocumentLink("cmdoc123", { now, secret });
    const [id, exp, mac] = token.split(".");
    expect(openDocumentLink(`${token}.x`, { now, secret })).toBeNull();
    expect(openDocumentLink(`${id}.${exp}.`, { now, secret })).toBeNull();
    expect(openDocumentLink(`.${exp}.${mac}`, { now, secret })).toBeNull();
    expect(openDocumentLink(`${id}..${mac}`, { now, secret })).toBeNull();
    // Подпись своя, но id или срок вне формата: мусор с той же подписью не принимается.
    const odd = (docId: string, e: string) => {
      const sealed = sealDocumentLink("x", { now, secret }).token.split(".")[2];
      return `${docId}.${e}.${sealed}`;
    };
    expect(openDocumentLink(odd("CMDOC", exp), { now, secret })).toBeNull();
    expect(openDocumentLink(odd(id, `${exp}Z`), { now, secret })).toBeNull();
    expect(openDocumentLink(odd(`-${id}`, exp), { now, secret })).toBeNull();
    expect(openDocumentLink(token, { now: expiresAt.getTime(), secret })).toEqual({ documentId: "cmdoc123", expiresAt });
    // Даже правильно подписанный id вне формата (не cuid) не принимается.
    for (const docId of ["-cmdoc", "cmdoc-", "CMDOC"]) expect(openDocumentLink(sealDocumentLink(docId, { now, secret }).token, { now, secret })).toBeNull();
  });

  it("по умолчанию в разработке — случайный секрет процесса: ссылка открывается тем же процессом", () => {
    const { token } = sealDocumentLink("cmdoc123");
    expect(openDocumentLink(token)?.documentId).toBe("cmdoc123");
    expect(openDocumentLink(token, { now: Date.now(), secret: "guess" })).toBeNull();
  });

  it("в ссылке нет персональных данных: только id документа, срок и подпись", () => {
    const { token } = sealDocumentLink("cmdoc123", { now, secret });
    expect(token).toMatch(/^cmdoc123\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
  });
});

describe("секрет ссылок из окружения", () => {
  it("FILE_URL_SECRET задан — ссылка подписана им", () => {
    vi.stubEnv("FILE_URL_SECRET", "configured-secret");
    resetEnvCache();
    try {
      const { token } = sealDocumentLink("cmdoc123");
      expect(openDocumentLink(token, { now: Date.now(), secret: "configured-secret" })?.documentId).toBe("cmdoc123");
    } finally {
      vi.stubEnv("FILE_URL_SECRET", "");
      resetEnvCache();
    }
  });
});

describe("«Поделиться в WhatsApp»", () => {
  it("короткий текст и ссылка в параметре text", () => {
    const url = whatsappShareUrl("Акт приёмки", "https://senim.kz/d/abc");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe("Акт приёмки: https://senim.kz/d/abc");
  });
});
