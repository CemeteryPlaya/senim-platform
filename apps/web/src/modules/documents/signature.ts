import type { SignMethod } from "@/generated/prisma/enums";

/**
 * Подпись ЭЦП НУЦ РК. Подписывается sha256 PDF-документа, а не JSON условий.
 *  - mock: имитация для разработки и демо;
 *  - sigex: eGov Mobile (QR) и NCALayer через SIGEX — скелет, реализует documents-engineer.
 * Сервер всегда проверяет подпись сам (verify), не доверяя клиенту.
 */

/** Кто должен подписать: iin — ИИН, с которым сервер сверит сертификат (мок по нему выпускает «сертификат»; без него — сертификат без ИИН). */
export type Signer = { userId: string; fullName: string; iin?: string };

export type SigningSession = {
  sessionId: string;
  method: SignMethod;
  /** Для EGOV_QR: данные для QR-кода (ссылка eGov Mobile). */
  qrPayload?: string;
  /** Для NCALAYER: что передать в NCALayer на клиенте. */
  clientPayload?: string;
  expiresAt: Date;
};

export type SigningResult =
  | { status: "pending" }
  | { status: "signed"; cms: string; /** Способ, которым подписали (сохраняется в Signature.method). */ method: SignMethod }
  | { status: "failed"; error: string };

export type VerifiedSignature =
  | {
      valid: true;
      certSubject: string;
      certSerial: string;
      /** ИИН из сертификата целиком: сервер сверяет его HMAC с ИИН стороны. Нет ИИН — подпись ничья. */
      certIin?: string;
      signedAt: Date;
    }
  | { valid: false; reason: string };

export interface SignatureProvider {
  readonly name: "mock" | "sigex";
  /** description — что подписант увидит в приложении («Договор подряда № Д-0014/2026»); собирает сервис из ru.documents. */
  startSigning(input: { documentId: string; description: string; sha256: string; method: SignMethod; signer: Signer }): Promise<SigningSession>;
  getResult(sessionId: string): Promise<SigningResult>;
  /** Проверяет, что CMS подписывает именно этот хэш и сертификат действителен. */
  verify(input: { cms: string; sha256: string }): Promise<VerifiedSignature>;
}
