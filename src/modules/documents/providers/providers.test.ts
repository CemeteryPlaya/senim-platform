import { describe, expect, it } from "vitest";
import { mockSignatureProvider } from "./mock-signature";
import { createSigexProvider, type SigexClient } from "./sigex";

const SHA = "a".repeat(64);
const signer = { userId: "u1", fullName: "Сапарова Айгерим", iinLast4: "0123" };

describe("mock-провайдер подписи", () => {
  it("подпись проходит проверку только для своего хэша и помнит способ", async () => {
    const session = await mockSignatureProvider.startSigning({ documentId: "d1", sha256: SHA, method: "NCALAYER", signer });
    const result = await mockSignatureProvider.getResult(session.sessionId);
    if (result.status !== "signed") throw new Error("ожидали подпись");
    expect(result.method).toBe("NCALAYER");
    expect(await mockSignatureProvider.verify({ cms: result.cms, sha256: SHA })).toMatchObject({ valid: true, certIinLast4: "0123" });
    expect(await mockSignatureProvider.verify({ cms: result.cms, sha256: "b".repeat(64) })).toMatchObject({ valid: false });
  });

  it("подделанный sessionId не даёт подписи", async () => {
    const session = await mockSignatureProvider.startSigning({ documentId: "d1", sha256: SHA, method: "EGOV_QR", signer });
    const [body, mac] = session.sessionId.split(".");
    const forged = `${body.slice(0, -2)}AA.${mac}`;
    expect(await mockSignatureProvider.getResult(forged)).toMatchObject({ status: "failed" });
  });
});

describe("SIGEX поверх порта SigexClient", () => {
  const client: SigexClient = {
    startQrSigning: async ({ sha256 }) => ({ operationId: `op-${sha256.slice(0, 4)}`, qrPayload: "qr-data", expiresAt: new Date(0) }),
    qrSignature: async (id) => (id === "op-aaaa" ? { status: "signed", cms: "cms" } : { status: "pending" }),
    verifyCms: async ({ sha256 }) =>
      sha256 === SHA ? { valid: true, subject: "CN=Сапарова", serial: "01", iin: "900101300123", signedAt: new Date(0) } : { valid: false, reason: "Подписан другой документ" },
  };
  const sigex = createSigexProvider(client);

  it("QR eGov Mobile: сессия, результат и проверка; наружу только 4 цифры ИИН", async () => {
    const session = await sigex.startSigning({ documentId: "d1", sha256: SHA, method: "EGOV_QR", signer });
    expect(session).toMatchObject({ sessionId: "op-aaaa", qrPayload: "qr-data", method: "EGOV_QR" });
    expect(await sigex.getResult("op-aaaa")).toEqual({ status: "signed", cms: "cms", method: "EGOV_QR" });
    expect(await sigex.getResult("op-bbbb")).toEqual({ status: "pending" });
    expect(await sigex.verify({ cms: "cms", sha256: SHA })).toMatchObject({ valid: true, certIinLast4: "0123" });
    expect(await sigex.verify({ cms: "cms", sha256: "b".repeat(64) })).toMatchObject({ valid: false });
  });

  it("NCALayer до изменения контракта — понятная ошибка", async () => {
    await expect(sigex.startSigning({ documentId: "d1", sha256: SHA, method: "NCALAYER", signer })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
