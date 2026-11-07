import { ru } from "@/i18n/ru";
import { fail } from "@/platform/errors";
import type { SignatureProvider } from "../signature";

/**
 * SIGEX (sigex.kz): подпись ЭЦП НУЦ РК через eGov Mobile (QR).
 *
 * Документацию SIGEX и исходники `sigex-qr-signing-client` в окружении разработки прочитать
 * не удалось (сеть закрыта), а API внешних сервисов мы не выдумываем. Поэтому провайдер разделён:
 *  - SigexClient — наш порт: три операции, которые по смыслу нужны от SIGEX. HTTP-клиент
 *    по документации SIGEX пишется отдельно и реализует этот порт;
 *  - createSigexProvider — логика вокруг порта (без состояния, проверка хэша, ИИН сертификата для сверки),
 *    она не зависит от формата API и проверена тестом с поддельным клиентом.
 * Пока клиента нет, signatureProvider() при SIGNATURE_PROVIDER=sigex отвечает «ещё не подключена».
 */
export interface SigexClient {
  /** Начать QR-подписание для eGov Mobile данных, хэш которых — sha256 PDF. */
  startQrSigning(input: { sha256: string; description: string }): Promise<{ operationId: string; qrPayload: string; expiresAt: Date }>;
  /** Результат процедуры: CMS в base64, когда пользователь подписал в приложении. */
  qrSignature(operationId: string): Promise<{ status: "pending" } | { status: "signed"; cms: string } | { status: "failed"; error: string }>;
  /** Проверка CMS: подписан ли этот sha256, действителен ли сертификат НУЦ РК; ИИН из сертификата. */
  verifyCms(input: { cms: string; sha256: string }): Promise<
    { valid: true; subject: string; serial: string; iin?: string; signedAt: Date } | { valid: false; reason: string }
  >;
}

/**
 * NCALayer работает в браузере (локальная программа НУЦ РК): CMS получает клиент, а не SIGEX.
 * Контракт CompleteSigning принимает только sessionId, поэтому этот способ подключается вместе
 * с изменением контракта (передача CMS с клиента) — см. отчёт documents-engineer.
 */
export function createSigexProvider(client: SigexClient): SignatureProvider {
  return {
    name: "sigex",

    async startSigning({ description, sha256, method }) {
      if (method !== "EGOV_QR") fail.validation(ru.documents.errors.ncalayerUnavailable);
      const op = await client.startQrSigning({ sha256, description });
      return { sessionId: op.operationId, method, qrPayload: op.qrPayload, expiresAt: op.expiresAt };
    },

    async getResult(sessionId) {
      const r = await client.qrSignature(sessionId);
      return r.status === "signed" ? { status: "signed", cms: r.cms, method: "EGOV_QR" } : r;
    },

    async verify({ cms, sha256 }) {
      const r = await client.verifyCms({ cms, sha256 });
      if (!r.valid) return r;
      return { valid: true, certSubject: r.subject, certSerial: r.serial, certIin: r.iin, signedAt: r.signedAt };
    },
  };
}
