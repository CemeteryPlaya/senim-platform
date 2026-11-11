import { hmacHex, openValue, randomToken, safeEqual, sealValue } from "@/platform/crypto";
import type { SignMethod } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { SignatureProvider } from "../signature";

// Мок не даёт юридической силы: «CMS» — это JSON с HMAC под фиксированным ключом мока.
// Без состояния: данные сессии зашиты в sessionId, поэтому работает на нескольких инстансах Vercel.
// ИИН подписанта — «сертификат» мока, его раскрывает identity (signing.ts) — запечатан (sealValue): sessionId уходит
// в браузер, CMS хранится в БД; полный ИИН из базы web не читается.
const MOCK_KEY = "senim-mock-signature-not-a-secret";
const IIN_CONTEXT = "documents.mock-signature.iin";
const c = ru.documents.signatureCheck;

type SessionData = { sha256: string; method: SignMethod; subject: string; iinEnc?: string; exp: number };
type MockCms = { v: 2; sha256: string; subject: string; serial: string; iinEnc?: string; ts: string; mac: string };

const seal = (data: object) => {
  const body = Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${body}.${hmacHex(MOCK_KEY, body)}`;
};

function unseal<T>(sealed: string): T | null {
  const [body, mac] = sealed.split(".");
  if (!body || !mac || !safeEqual(mac, hmacHex(MOCK_KEY, body))) return null;
  return JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
}

const cmsMac = (p: Omit<MockCms, "mac">) =>
  hmacHex(MOCK_KEY, JSON.stringify([p.v, p.sha256, p.subject, p.serial, p.iinEnc ?? "", p.ts]));

export const mockSignatureProvider: SignatureProvider = {
  name: "mock",

  async startSigning({ sha256, method, signer }) {
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const data: SessionData = { sha256, method, subject: signer.fullName, iinEnc: signer.iin ? sealValue(signer.iin, IIN_CONTEXT) : undefined, exp: expiresAt.getTime() };
    const sessionId = seal(data);
    return {
      sessionId,
      method,
      qrPayload: method === "EGOV_QR" ? `mock-egov://sign/${sessionId}` : undefined,
      expiresAt,
    };
  },

  async getResult(sessionId) {
    const s = unseal<SessionData>(sessionId);
    if (!s || s.exp < Date.now()) return { status: "failed", error: c.sessionExpired };
    const body = {
      v: 2 as const,
      sha256: s.sha256,
      subject: s.subject,
      serial: randomToken(8).toUpperCase(),
      iinEnc: s.iinEnc,
      ts: new Date().toISOString(),
    };
    return { status: "signed", method: s.method, cms: Buffer.from(JSON.stringify({ ...body, mac: cmsMac(body) })).toString("base64") };
  },

  async verify({ cms, sha256 }) {
    try {
      const { mac, ...body } = JSON.parse(Buffer.from(cms, "base64").toString("utf8")) as MockCms;
      if (!safeEqual(mac, cmsMac(body))) return { valid: false, reason: c.damaged };
      if (body.sha256 !== sha256) return { valid: false, reason: c.otherDocument };
      return { valid: true, certSubject: body.subject, certSerial: body.serial, certIin: body.iinEnc ? openValue(body.iinEnc, IIN_CONTEXT) : undefined, signedAt: new Date(body.ts) };
    } catch {
      return { valid: false, reason: c.unreadable };
    }
  },
};
