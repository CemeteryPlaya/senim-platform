import { isRedirectError } from "next/dist/client/components/redirect-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { testBin, testIin } from "@/seed/kz-id";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { getCurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { db } from "@/platform/db";
import { freshBrowser, setEnv } from "../../../../../../test/factories/identity";
import { FAKE_OTP_CODE, identityFake } from "../../../../../../test/stubs/identity";
import { grantConsentAction } from "../../consent/actions";
import { requestCodeAction, verifyCodeAction } from "../../login/actions";
import { introduceAction } from "../../welcome/actions";
import type { Answers } from "./_parts/schema";
import { initialAnswers } from "./_parts/steps";
import { registerMasterAction } from "./actions";

const h = vi.hoisted(() => ({ revalidated: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => void h.revalidated.push(args) }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.masterRegister.errors;
const IIN = testIin("910803", 3, 21);
const OTHER_IIN = testIin("880412", 3, 22);
const BIN = testBin("2101", 16);
const DIRECTOR_IIN = testIin("800215", 3, 41);
const STATUS = "/v2/register/executor";

beforeEach(() => {
  h.revalidated = [];
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ SMS_PROVIDER: "mock" });
});

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

/** Всё, что ушло в консоль (логгер пишет JSON-строки через console.*) с уровнем debug. */
function captureLogs() {
  process.env.LOG_LEVEL = "debug";
  const lines: string[] = [];
  const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" "))),
  );
  return { lines, stop: () => spies.forEach((s) => s.mockRestore()) };
}

/** Новый человек: вход по номеру, согласие, ФИО и ИИН — заказчик, готовый к анкете мастера. */
async function buyer(phone: string, iin = IIN) {
  await run(requestCodeAction({ phone }));
  await run(verifyCodeAction({ phone, code: FAKE_OTP_CODE, next: "" }));
  await run(grantConsentAction({ agreed: "on", version: CONSENT_DOCUMENTS.PD_PROCESSING.version }));
  await run(introduceAction({ fullName: "Жумабаев Ерлан", iin, next: "" }));
  return (await getCurrentUser())!;
}

const base: Answers = { ...initialAnswers(), city: "Астана", district: "Есильский район", yearsExperience: "7" };
const selfEmployed: Answers = { ...base, legalForm: "SELF_EMPLOYED", legalName: "Жумабаев Ерлан" };
const too: Answers = {
  ...base,
  legalForm: "TOO",
  legalName: "ТОО «Ағаш»",
  binIin: `${BIN.slice(0, 6)} ${BIN.slice(6)}`,
  directorName: "Тулегенов Бауыржан",
  directorIin: DIRECTOR_IIN,
};

const profiles = (userId: string) => db.executorProfile.findMany({ where: { userId } });
const registerCalls = () => identityFake.calls.filter((c) => c.method === "registerParty");

describe("registerMasterAction", () => {
  it("самозанятый: профиль на проверке по ИИН из знакомства, роль мастера активна, дальше — экран статуса", async () => {
    const user = await buyer("+77000008601");
    expect(await run(registerMasterAction(selfEmployed))).toEqual({ redirect: STATUS });

    const [profile] = await profiles(user.id);
    expect(profile).toMatchObject({ status: "PENDING", legalForm: "SELF_EMPLOYED", legalName: "Жумабаев Ерлан", binIinLast4: IIN.slice(-4), city: "Астана", district: "Есильский район", yearsExperience: 7 });
    expect((await getCurrentUser())?.role).toBe("EXECUTOR");
    // Оболочка перерисовывается с новой ролью.
    expect(h.revalidated).toContainEqual(["/(app)", "layout"]);
  });

  it("ТОО: БИН и ИИН директора без пробелов уходят в identity; в профиле — 4 цифры БИН", async () => {
    const user = await buyer("+77000008602");
    expect(await run(registerMasterAction(too))).toEqual({ redirect: STATUS });
    const [profile] = await profiles(user.id);
    expect(profile).toMatchObject({ legalForm: "TOO", binIinLast4: BIN.slice(-4), signerFullName: "Тулегенов Бауыржан" });
  });

  it("повторная отправка — тот же итог и одна заявка", async () => {
    const user = await buyer("+77000008603");
    const [first, second] = await Promise.all([run(registerMasterAction(selfEmployed)), run(registerMasterAction(selfEmployed))]);
    expect(first).toEqual({ redirect: STATUS });
    expect(second).toEqual({ redirect: STATUS });
    expect(await run(registerMasterAction(selfEmployed))).toEqual({ redirect: STATUS });
    expect(await profiles(user.id)).toHaveLength(1);
  });

  it("ошибки анкеты — у полей текстами v2, identity не вызывается", async () => {
    await buyer("+77000008604");
    const res = await run(registerMasterAction({ ...too, binIin: "", directorIin: "123", city: "", yearsExperience: "99" }));
    expect(res).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { binIin: [t.binRequired], directorIin: [t.directorIin], city: [t.city], yearsExperience: [t.experience] },
    });
    expect(registerCalls()).toHaveLength(0);
  });

  it("БИН уже у другого мастера — ошибка у поля БИН, номера в ответе нет", async () => {
    await buyer("+77000008605");
    expect(await run(registerMasterAction(too))).toEqual({ redirect: STATUS });

    freshBrowser({ "user-agent": "vitest" });
    const other = await buyer("+77000008606", OTHER_IIN);
    const res = await run(registerMasterAction({ ...too, directorIin: testIin("790101", 3, 7) }));
    expect(res).toMatchObject({ ok: false, code: "CONFLICT", error: t.binIinTaken, fieldErrors: { binIin: [t.binIinTaken] } });
    expect(JSON.stringify(res)).not.toContain(BIN);
    expect(await profiles(other.id)).toHaveLength(0);
  });

  it("повторная подача после отказа: тот же профиль снова на проверке, причина сброшена, данные новые", async () => {
    const user = await buyer("+77000008608");
    expect(await run(registerMasterAction(selfEmployed))).toEqual({ redirect: STATUS });
    const [first] = await profiles(user.id);
    await db.executorProfile.update({ where: { id: first.id }, data: { status: "REJECTED", rejectReason: "Опыт не подтверждён", reviewedAt: new Date() } });

    expect(await run(registerMasterAction({ ...selfEmployed, city: "Алматы", yearsExperience: "12" }))).toEqual({ redirect: STATUS });
    const again = await profiles(user.id);
    expect(again).toHaveLength(1);
    expect(again[0]).toMatchObject({ id: first.id, status: "PENDING", rejectReason: null, reviewedAt: null, city: "Алматы", yearsExperience: 12 });
  });

  it("гость — UNAUTHENTICATED", async () => {
    expect(await run(registerMasterAction(selfEmployed))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("ИИН и БИН не попадают в журнал ни при успехе, ни при ошибке", async () => {
    await buyer("+77000008607");
    const logs = captureLogs();
    try {
      await run(registerMasterAction({ ...too, binIin: "123456789012" }));
      identityFake.failNextWithCode("some_unmapped_failure");
      await run(registerMasterAction(too));
      await run(registerMasterAction(too));
    } finally {
      logs.stop();
    }
    const all = logs.lines.join("\n");
    for (const secret of [BIN, DIRECTOR_IIN, BIN.slice(0, 6), DIRECTOR_IIN.slice(0, 6)]) expect(all, secret).not.toContain(secret);
  });
});
