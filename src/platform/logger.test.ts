import { afterEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
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

  it("ошибка Prisma с данными запроса: только имя, код и поля индекса — без message и стека с message", () => {
    const known = new Prisma.PrismaClientKnownRequestError("Unique constraint failed: iinHash = 900101300123, phone +77001234567", {
      code: "P2002",
      clientVersion: "7",
      meta: { target: ["iinHash"], modelName: "User" },
    });
    const line = logged({ error: known });
    expect(line.error).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P2002", target: ["iinHash"] });
    expect(JSON.stringify(line)).not.toMatch(/900101300123|7001234567|Unique constraint/);
  });

  it("ошибка разбора запроса Prisma — только имя", () => {
    const invalid = new Prisma.PrismaClientValidationError("Argument `phone`: +77001234567 is invalid", { clientVersion: "7" });
    const second = logged({ error: invalid });
    expect(second.error).toMatchObject({ name: "PrismaClientValidationError" });
    expect(JSON.stringify(second)).not.toMatch(/7001234567|Argument/);
  });

  it("в message и стеке обычной ошибки скрыты 12 цифр подряд и телефоны", () => {
    const line = logged({ error: new Error("ИИН 900101300123 занят, звоните +7 (700) 123-45-67 или 87011234567; заявка 42") });
    const text = JSON.stringify(line);
    expect(text).not.toMatch(/900101300123|123-45-67|87011234567/);
    expect((line.error as { message: string }).message).toMatch(/заявка 42$/);
  });

  it("служебные поля остаются как есть", () => {
    expect(logged({ dealId: "d1", fileId: "f1", reason: "timeout" })).toMatchObject({ dealId: "d1", fileId: "f1", reason: "timeout" });
  });
});
