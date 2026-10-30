import type { SignMethod } from "@/generated/prisma/enums";

/**
 * Подпись ЭЦП НУЦ РК. Подписывается sha256 PDF-документа, а не JSON условий.
 *  - mock: имитация для разработки и демо;
 *  - sigex: eGov Mobile (QR) и NCALayer через SIGEX — скелет, реализует documents-engineer.
 * Сервер всегда проверяет подпись сам (verify), не доверяя клиенту.
 */

export type Signer = { userId: string; fullName: string; iinLast4?: string };

export type SigningSession = {
  sessionId: string;
  method: SignMethod;
  /** Для EGOV_QR: данные для QR-кода (ссылка eGov Mobile). */
  qrPayload?: string;
  /** Для NCALAYER: что передать в NCALayer на клиенте. */
  clientPayload?: string;
  expiresAt: Date;
};

export type SigningResult = { status: "pending" } | { status: "signed"; cms: string } | { status: "failed"; error: string };

export type VerifiedSignature =
  | { valid: true; certSubject: string; certSerial: string; certIinLast4?: string; signedAt: Date }
  | { valid: false; reason: string };

export interface SignatureProvider {
  readonly name: "mock" | "sigex";
  startSigning(input: { documentId: string; sha256: string; method: SignMethod; signer: Signer }): Promise<SigningSession>;
  getResult(sessionId: string): Promise<SigningResult>;
  /** Проверяет, что CMS подписывает именно этот хэш и сертификат действителен. */
  verify(input: { cms: string; sha256: string }): Promise<VerifiedSignature>;
}
