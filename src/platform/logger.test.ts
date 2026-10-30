import { afterEach, describe, expect, it, vi } from "vitest";
import { logger } from "./logger";

/** Что ушло в консоль одной строкой JSON. */
function logged(fields: Record<string, unknown>): Record<string, unknown> {
  const out = vi.spyOn(console, "log").mockImplementation(() => {});
  logger.info("проверка", fields);
  const line = out.mock.calls[0]?.[0];
  if (typeof line !== "string") throw new Error("логгер ничего не записал");
  return JSON.parse(line) as Record<string, unknown>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logger: скрытие персональных данных", () => {
  it.each([
    "phone",
    "clientPhone",
    "PHONE_NUMBER",
    "iin",
    "binIinEnc",
    "iinEnc",
    "code",
    "otpCode",
    "token",
    "accessToken",
    "password",
    "secret",
    "webhookSecret",
    "authorization",
    "cookie",
    "signature",
    "text",
    "messageText",
    "body",
    "fullName",
    "address",
    "legalName",
    "comment",
    "report",
    "description",
    "position",
  ])("значение ключа %s не попадает в лог", (key) => {
    const line = logged({ [key]: "+77001234567" });
    expect(line[key]).toBe("[скрыто]");
    expect(JSON.stringify(line)).not.toContain("+77001234567");
  });

  it("скрывает и во вложенных объектах и массивах", () => {
    const line = logged({ deal: { client: { fullName: "Иванов Иван" } }, items: [{ address: "ул. Абая, 1" }] });
    expect(JSON.stringify(line)).not.toMatch(/Иванов|Абая/);
  });

  it("служебные поля остаются как есть", () => {
    expect(logged({ dealId: "d1", fileId: "f1", reason: "timeout" })).toMatchObject({ dealId: "d1", fileId: "f1", reason: "timeout" });
  });
});
