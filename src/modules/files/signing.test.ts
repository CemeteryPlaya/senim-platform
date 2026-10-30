import { describe, expect, it } from "vitest";
import { localDownloadUrl, openUploadToken, sealUploadToken, verifyDownload, type UploadClaims } from "./signing";

const SECRET = "test-secret";
const NOW = 1_800_000_000_000;

function parse(url: string) {
  const u = new URL(url, "http://x");
  const key = decodeURIComponent(u.pathname.replace(/^\/api\/files\//, ""));
  return { key, exp: u.searchParams.get("exp") ?? "", sig: u.searchParams.get("sig") ?? "", name: u.searchParams.get("name") ?? undefined };
}

describe("подписанная ссылка на скачивание (local)", () => {
  const url = localDownloadUrl("stage_report/2026/10/abc.jpg", { expiresInSec: 60, fileName: "акт.pdf" }, { now: NOW, secret: SECRET });

  it("ведёт на маршрут /api/files/<ключ> и проходит проверку до истечения", () => {
    expect(url.startsWith("/api/files/stage_report/2026/10/abc.jpg?")).toBe(true);
    expect(verifyDownload(parse(url), { now: NOW + 59_000, secret: SECRET })).toBe(true);
  });

  it("истёкшая ссылка отклоняется", () => {
    expect(verifyDownload(parse(url), { now: NOW + 61_000, secret: SECRET })).toBe(false);
  });

  it("подделанная ссылка отклоняется: другой ключ, срок, имя или секрет", () => {
    const p = parse(url);
    expect(verifyDownload({ ...p, key: "stage_report/2026/10/other.jpg" }, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyDownload({ ...p, exp: String(Number(p.exp) + 3600) }, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyDownload({ ...p, name: "другое.pdf" }, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyDownload({ ...p, sig: p.sig.replace(/^./, (c) => (c === "a" ? "b" : "a")) }, { now: NOW, secret: SECRET })).toBe(false);
    expect(verifyDownload(p, { now: NOW, secret: "другой-секрет" })).toBe(false);
  });

  it("мусор вместо срока отклоняется", () => {
    expect(verifyDownload({ ...parse(url), exp: "abc" }, { now: NOW, secret: SECRET })).toBe(false);
  });
});

describe("токен загрузки", () => {
  const claims: UploadClaims = {
    id: "upl1",
    userId: "u1",
    purpose: "REQUEST_ROOM",
    provider: "local",
    stagingKey: "uploads/upl1",
    contentType: "image/jpeg",
    maxBytes: 1000,
    issuedAt: NOW,
    exp: NOW + 60_000,
  };

  it("открывается тем же секретом до истечения", () => {
    const token = sealUploadToken(claims, SECRET);
    expect(openUploadToken(token, { now: NOW + 1000, secret: SECRET })).toEqual(claims);
  });

  it("истёкший, подделанный или чужим секретом — null", () => {
    const token = sealUploadToken(claims, SECRET);
    expect(openUploadToken(token, { now: NOW + 60_001, secret: SECRET })).toBeNull();
    expect(openUploadToken(token, { now: NOW, secret: "x" })).toBeNull();
    const [body, sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...claims, userId: "u2" })).toString("base64url");
    expect(openUploadToken(`${forged}.${sig}`, { now: NOW, secret: SECRET })).toBeNull();
    expect(openUploadToken(`${body}`, { now: NOW, secret: SECRET })).toBeNull();
    expect(openUploadToken("", { now: NOW, secret: SECRET })).toBeNull();
  });
});
