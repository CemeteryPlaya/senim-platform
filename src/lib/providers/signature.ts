import { createHash, randomBytes } from "node:crypto";

/**
 * Провайдер подписи ЭЦП.
 * Демо: имитация. В продакшене:
 *  - NCALayer (локальный WebSocket wss://127.0.0.1:13579) подписывает CMS на стороне клиента,
 *  - сервер проверяет подпись и OCSP-статус сертификата НУЦ РК (например, через NCANode),
 *  - альтернатива для физлиц — подписание в eGov Mobile по QR (через SIGEX или аналог).
 */
export interface SignatureProvider {
  sign(input: { docHash: string; signerName: string; iin: string; method: SignMethod }): Promise<SignResult>;
}

export type SignMethod = "NCALAYER" | "EGOV_QR";
export type SignResult = { certSerial: string; method: SignMethod };

export function hashDocument(content: string) {
  return createHash("sha256").update(content).digest("hex");
}

export const mockSignatureProvider: SignatureProvider = {
  async sign({ method }) {
    return { certSerial: randomBytes(10).toString("hex").toUpperCase(), method };
  },
};
