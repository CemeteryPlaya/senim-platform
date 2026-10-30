import { hmacHex, randomToken, safeEqual } from "@/platform/crypto";
import type { SignatureProvider } from "../signature";

// Мок не даёт юридической силы: «CMS» — это JSON с HMAC под фиксированным ключом мока.
// Без состояния: данные сессии зашиты в sessionId, поэтому работает на нескольких инстансах Vercel.
const MOCK_KEY = "senim-mock-signature-not-a-secret";

type SessionData = { sha256: string; subject: string; iinLast4?: string; exp: number };
type MockCms = { v: 1; sha256: string; subject: string; serial: string; iinLast4?: string; ts: string; mac: string };

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
  hmacHex(MOCK_KEY, JSON.stringify([p.sha256, p.subject, p.serial, p.iinLast4 ?? "", p.ts]));

export const mockSignatureProvider: SignatureProvider = {
  name: "mock",

  async startSigning({ sha256, method, signer }) {
    const expiresAt = new Date(Date.now() + 5 * 60_000);
    const data: SessionData = { sha256, subject: signer.fullName, iinLast4: signer.iinLast4, exp: expiresAt.getTime() };
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
    if (!s || s.exp < Date.now()) return { status: "failed", error: "Сессия подписания не найдена или истекла" };
    const body = {
      v: 1 as const,
      sha256: s.sha256,
      subject: s.subject,
      serial: randomToken(8).toUpperCase(),
      iinLast4: s.iinLast4,
      ts: new Date().toISOString(),
    };
    return { status: "signed", cms: Buffer.from(JSON.stringify({ ...body, mac: cmsMac(body) })).toString("base64") };
  },

  async verify({ cms, sha256 }) {
    try {
      const { mac, ...body } = JSON.parse(Buffer.from(cms, "base64").toString("utf8")) as MockCms;
      if (!safeEqual(mac, cmsMac(body))) return { valid: false, reason: "Подпись повреждена" };
      if (body.sha256 !== sha256) return { valid: false, reason: "Подписан другой документ" };
      return { valid: true, certSubject: body.subject, certSerial: body.serial, certIinLast4: body.iinLast4, signedAt: new Date(body.ts) };
    } catch {
      return { valid: false, reason: "Не удалось прочитать подпись" };
    }
  },
};
