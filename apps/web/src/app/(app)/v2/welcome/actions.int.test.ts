import { isRedirectError } from "next/dist/client/components/redirect-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { getCurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { FAKE_OTP_CODE, identityFake } from "../../../../../test/stubs/identity";
import { grantConsentAction } from "../consent/actions";
import { requestCodeAction, verifyCodeAction } from "../login/actions";
import { introduceAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.onboarding.welcome.errors;
const ci = ru.identity.clientIdentity;
const NEXT = "/v2/deals/1";
const IIN = testIin("870304", 3, 61);
const OTHER_IIN = testIin("900101", 3, 62);

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ SMS_PROVIDER: "mock" });
});

/** Всё, что ушло в консоль (логгер пишет JSON-строки через console.log/warn/error) с включённым уровнем debug. */
function captureLogs() {
  process.env.LOG_LEVEL = "debug";
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" "))),
  );
  return { lines, stop: () => spies.forEach((s) => s.mockRestore()) };
}

afterEach(() => {
  delete process.env.LOG_LEVEL;
});

async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (e) {
    if (!isRedirectError(e)) throw e;
    return { redirect: e.digest.split(";")[2] };
  }
}

/** Вход новым номером и согласие: человек на шаге знакомства. */
async function atWelcome(phone: string, consent = true) {
  await run(requestCodeAction({ phone }));
  await run(verifyCodeAction({ phone, code: FAKE_OTP_CODE, next: "" }));
  if (consent) await run(grantConsentAction({ agreed: "on", version: CONSENT_DOCUMENTS.PD_PROCESSING.version }));
  return (await getCurrentUser())!;
}

describe("introduceAction", () => {
  it("ФИО и ИИН записывает identity, в проекции — ФИО и последние 4 цифры; дальше — подтверждение почты с возвратом", async () => {
    const user = await atWelcome("+77000007901");

    // Пробелы в ИИН и по краям ФИО убираются.
    const res = await run(introduceAction({ fullName: "  Сапаров  Ерлан ", iin: `${IIN.slice(0, 6)} ${IIN.slice(6)}`, next: NEXT }));
    expect(res).toEqual({ redirect: `/v2/email?next=${encodeURIComponent(NEXT)}` });

    expect(identityFake.personOf(user.id)).toMatchObject({ fullName: "Сапаров Ерлан", iinLast4: IIN.slice(-4) });
    expect(await db.user.findUniqueOrThrow({ where: { id: user.id } })).toMatchObject({ fullName: "Сапаров Ерлан", iinLast4: IIN.slice(-4) });
  });

  it("чужой next отбрасывается", async () => {
    await atWelcome("+77000007902");
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "https://evil.example/x" }))).toEqual({ redirect: "/v2/email" });
  });

  it("пустые поля — ошибки у полей, identity не вызывается", async () => {
    await atWelcome("+77000007903");
    const calls = () => identityFake.calls.filter((c) => c.method === "recordPerson");
    expect(await run(introduceAction({ fullName: "  ", iin: " ", next: "" }))).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { fullName: [t.fullNameRequired], iin: [t.iinRequired] },
    });
    expect(calls()).toHaveLength(0);
  });

  it("неверный ИИН и ФИО из одного слова — отказы identity у своих полей", async () => {
    await atWelcome("+77000007904");
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: "123", next: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { iin: [ci.iinInvalid] },
    });
    expect(await run(introduceAction({ fullName: "Ерлан", iin: IIN, next: "" }))).toMatchObject({
      ok: false,
      fieldErrors: { fullName: [ci.fullNameInvalid] },
    });
  });

  it("ИИН уже у другого человека — ошибка у поля ИИН, ИИН в тексте нет", async () => {
    const first = await atWelcome("+77000007905");
    await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }));
    expect(identityFake.personOf(first.id)).toBeDefined();

    freshBrowser({ "user-agent": "vitest" });
    await atWelcome("+77000007906");
    const res = await run(introduceAction({ fullName: "Другой Человек", iin: IIN, next: "" }));
    expect(res).toMatchObject({ ok: false, code: "CONFLICT", error: t.iinTaken, fieldErrors: { iin: [t.iinTaken] } });
    expect(JSON.stringify(res)).not.toContain(IIN);
  });

  it("уже указанные не меняются: другой ИИН — CONFLICT, тот же — тот же ответ (повтор формы безопасен)", async () => {
    await atWelcome("+77000007907");
    await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }));
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: OTHER_IIN, next: "" }))).toMatchObject({
      ok: false,
      code: "CONFLICT",
      fieldErrors: { iin: [expect.any(String)] },
    });
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }))).toEqual({ redirect: "/v2/email" });
  });

  it("без согласия — CONSENT_REQUIRED (форма уводит на согласие)", async () => {
    await atWelcome("+77000007908", false);
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }))).toMatchObject({ ok: false, code: "CONSENT_REQUIRED" });
  });

  it("гость — UNAUTHENTICATED", async () => {
    expect(await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("ИИН не попадает в журнал ни при успехе, ни при ошибке (формат, конфликт, сбой identity)", async () => {
    await atWelcome("+77000007909");
    const logs = captureLogs();
    try {
      await run(introduceAction({ fullName: "Сапаров Ерлан", iin: "123", next: "" }));
      await run(introduceAction({ fullName: "Сапаров Ерлан", iin: OTHER_IIN, next: "" }));
      identityFake.failNextWithCode("some_unmapped_failure");
      await run(introduceAction({ fullName: "Сапаров Ерлан", iin: OTHER_IIN, next: "" }));
      await run(introduceAction({ fullName: "Сапаров Ерлан", iin: IIN, next: "" }));
    } finally {
      logs.stop();
    }
    const all = logs.lines.join("\n");
    for (const secret of [IIN, OTHER_IIN, IIN.slice(0, 6), "Сапаров"]) expect(all, secret).not.toContain(secret);
  });
});
