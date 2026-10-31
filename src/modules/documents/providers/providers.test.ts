import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/env";
import { mockSignatureProvider } from "./mock-signature";
import { createSigexProvider, type SigexClient } from "./sigex";

const SHA = "a".repeat(64);
const IIN = "900101300123";

// Мок шифрует ИИН ключом разработки (encryptPii), а env() требует строку подключения к базе — в модульном тесте её нет.
beforeAll(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://unit-test");
  resetEnvCache();
});
afterAll(() => {
  vi.unstubAllEnvs();
  resetEnvCache();
});
const signer = { userId: "u1", fullName: "Сапарова Айгерим", iin: IIN };
const DESC = "Договор подряда № Д-0014/2026";

describe("mock-провайдер подписи", () => {
  it("подпись проходит проверку только для своего хэша, помнит способ и возвращает полный ИИН подписанта", async () => {
    const session = await mockSignatureProvider.startSigning({ documentId: "d1", description: DESC, sha256: SHA, method: "NCALAYER", signer });
    const result = await mockSignatureProvider.getResult(session.sessionId);
    if (result.status !== "signed") throw new Error("ожидали подпись");
    expect(result.method).toBe("NCALAYER");
    expect(await mockSignatureProvider.verify({ cms: result.cms, sha256: SHA })).toMatchObject({ valid: true, certIin: IIN });
    expect(await mockSignatureProvider.verify({ cms: result.cms, sha256: "b".repeat(64) })).toMatchObject({ valid: false });
  });

  it("ИИН не лежит открытым ни в sessionId (уходит в браузер), ни в CMS (хранится в БД)", async () => {
    const session = await mockSignatureProvider.startSigning({ documentId: "d1", description: DESC, sha256: SHA, method: "EGOV_QR", signer });
    const result = await mockSignatureProvider.getResult(session.sessionId);
    if (result.status !== "signed") throw new Error("ожидали подпись");
    const decoded = [Buffer.from(session.sessionId.split(".")[0], "base64url").toString("utf8"), Buffer.from(result.cms, "base64").toString("utf8")];
    for (const text of decoded) expect(text).not.toContain(IIN);
  });

  it("подделанный sessionId не даёт подписи", async () => {
    const session = await mockSignatureProvider.startSigning({ documentId: "d1", description: DESC, sha256: SHA, method: "EGOV_QR", signer });
    const [body, mac] = session.sessionId.split(".");
    const forged = `${body.slice(0, -2)}AA.${mac}`;
    expect(await mockSignatureProvider.getResult(forged)).toMatchObject({ status: "failed" });
  });
});

describe("SIGEX поверх порта SigexClient", () => {
  const descriptions: string[] = [];
  const client: SigexClient = {
    startQrSigning: async ({ sha256, description }) => {
      descriptions.push(description);
      return { operationId: `op-${sha256.slice(0, 4)}`, qrPayload: "qr-data", expiresAt: new Date(0) };
    },
    qrSignature: async (id) => (id === "op-aaaa" ? { status: "signed", cms: "cms" } : { status: "pending" }),
    verifyCms: async ({ sha256 }) =>
      sha256 === SHA ? { valid: true, subject: "CN=Сапарова", serial: "01", iin: "900101300123", signedAt: new Date(0) } : { valid: false, reason: "Подписан другой документ" },
  };
  const sigex = createSigexProvider(client);

  it("QR eGov Mobile: сессия, результат и проверка; ИИН сертификата целиком — для сверки по HMAC", async () => {
    const session = await sigex.startSigning({ documentId: "d1", description: DESC, sha256: SHA, method: "EGOV_QR", signer });
    expect(session).toMatchObject({ sessionId: "op-aaaa", qrPayload: "qr-data", method: "EGOV_QR" });
    // В eGov Mobile подписант видит документ по номеру, а не внутренний id.
    expect(descriptions).toEqual([DESC]);
    expect(await sigex.getResult("op-aaaa")).toEqual({ status: "signed", cms: "cms", method: "EGOV_QR" });
    expect(await sigex.getResult("op-bbbb")).toEqual({ status: "pending" });
    expect(await sigex.verify({ cms: "cms", sha256: SHA })).toMatchObject({ valid: true, certIin: "900101300123" });
    expect(await sigex.verify({ cms: "cms", sha256: "b".repeat(64) })).toMatchObject({ valid: false });
  });

  it("NCALayer до изменения контракта — понятная ошибка", async () => {
    await expect(sigex.startSigning({ documentId: "d1", description: DESC, sha256: SHA, method: "NCALAYER", signer })).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
