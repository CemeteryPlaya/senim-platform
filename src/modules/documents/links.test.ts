import { describe, expect, it } from "vitest";
import { LINK_TTL_SEC, openDocumentLink, sealDocumentLink, whatsappShareUrl } from "./links";

const secret = "test-secret";
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

  it("в ссылке нет персональных данных: только id документа, срок и подпись", () => {
    const { token } = sealDocumentLink("cmdoc123", { now, secret });
    expect(token).toMatch(/^cmdoc123\.[0-9a-z]+\.[A-Za-z0-9_-]{43}$/);
  });
});

describe("«Поделиться в WhatsApp»", () => {
  it("короткий текст и ссылка в параметре text", () => {
    const url = whatsappShareUrl("Акт приёмки", "https://senim.kz/d/abc");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.slice("https://wa.me/?text=".length))).toBe("Акт приёмки: https://senim.kz/d/abc");
  });
});
