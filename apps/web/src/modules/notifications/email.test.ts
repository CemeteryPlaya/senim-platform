import { afterEach, describe, expect, it, vi } from "vitest";
import { isAppError } from "@/platform/errors";
import { logger } from "@/platform/logger";
import { createMockEmailProvider, sendEmail } from "./email";

// Хэш адресата — HMAC ключом из env (как ИИН); базе данных этот тест не нужен.
process.env.DATABASE_URL ??= "postgresql://localhost/unused";
afterEach(() => vi.restoreAllMocks());

const act = { filename: "akt-A-0007.pdf", contentType: "application/pdf", content: new TextEncoder().encode("%PDF-1.7\n%%EOF") };
const message = { to: "Aigerim.K@example.kz", subject: "Акт приёмки по сделке №7", text: "Здравствуйте! Акт во вложении.", attachments: [act], idempotencyKey: "act:doc1:user1" };

describe("sendEmail (mock)", () => {
  it("пишет в журнал разработки без адреса, текста и содержимого вложений", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const result = await sendEmail(message, createMockEmailProvider());

    expect(result.duplicate).toBe(false);
    expect(info).toHaveBeenCalledTimes(1);
    const [event, fields] = info.mock.calls[0]!;
    expect(event).toBe("email.mock.sent");
    expect(fields).toMatchObject({ subject: message.subject, attachments: [{ filename: act.filename, contentType: "application/pdf", bytes: act.content.byteLength }] });
    const logged = JSON.stringify(fields);
    expect(logged).not.toMatch(/aigerim|example\.kz|Здравствуйте|%PDF/i);
    expect(logged).toMatch(/"toHash":"[0-9a-f]{16}"/);
  });

  it("повтор с тем же ключом идемпотентности письмо второй раз не шлёт", async () => {
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const provider = createMockEmailProvider();
    const first = await sendEmail(message, provider);
    const again = await sendEmail(message, provider);
    const other = await sendEmail({ ...message, idempotencyKey: "act:doc1:user2" }, provider);
    expect(again).toEqual({ providerMessageId: first.providerMessageId, duplicate: true });
    expect(other.providerMessageId).not.toBe(first.providerMessageId);
    expect(info).toHaveBeenCalledTimes(2);
  });

  it("некорректный адрес или пустая тема — ошибка проверки, письмо не уходит", async () => {
    const provider = createMockEmailProvider();
    const send = vi.spyOn(provider, "send");
    for (const bad of [{ ...message, to: "не-почта" }, { ...message, subject: " " }]) {
      const e = await sendEmail(bad, provider).catch((err: unknown) => err);
      expect(isAppError(e) && e.code).toBe("VALIDATION");
    }
    expect(send).not.toHaveBeenCalled();
  });
});
