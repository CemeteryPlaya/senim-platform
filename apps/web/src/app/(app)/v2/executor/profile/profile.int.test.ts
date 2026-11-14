import { isRedirectError } from "next/dist/client/components/redirect-error";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KycStatus } from "@/gen/senim/identity/v1/identity_pb";
import { ru } from "@/i18n/ru";
import { ABOUT_MAX_LENGTH, MASK, MEASUREMENT_FEE_MAX, MEASUREMENT_FEE_MIN } from "@/modules/companies";
import { KYC_MAX_FILES } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { dealAt, makePhoto, signAct } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import { identityFake } from "../../../../../../test/stubs/identity";
import { ABOUT_MAX, FEE_MAX, FEE_MIN } from "./_parts/company-schema";
import { KYC_MAX } from "./kyc/kyc-view";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}));

const { default: CompanyPage } = await import("./page");
const { default: KycPage } = await import("./kyc/page");
const { default: PayoutPage } = await import("./payout/page");
const { saveCompanyAction } = await import("./actions");
const { submitKycAction } = await import("./kyc/actions");
const { savePayoutAction } = await import("./payout/actions");

const m = ru.app.masterCompany;
const IBAN = "KZ86125KZT5004100100";
const GROUPED = "KZ86 125K ZT50 0410 0100";
type Params = Record<string, string>;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});
afterEach(() => {
  delete process.env.LOG_LEVEL;
  vi.restoreAllMocks();
});

async function master(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const executor = await makeExecutor(opts);
  await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(executor);
  return executor;
}

async function render(page: (props: { searchParams: Promise<Params> }) => Promise<ReactElement>, params: Params = {}): Promise<string> {
  return renderToStaticMarkup(await page({ searchParams: Promise.resolve(params) }));
}
const renderCompany = async () => renderToStaticMarkup(await CompanyPage());
const renderPayout = async () => renderToStaticMarkup(await PayoutPage());

const primaries = (out: string) => out.split("data-primary-action").length - 1;
const h1 = (out: string) => (out.match(/<h1/g) ?? []).length;
const redirectOf = async (run: () => Promise<unknown>): Promise<string | null> => {
  try {
    await run();
    return null;
  } catch (e) {
    if (!isRedirectError(e)) throw e;
    return e.digest.split(";")[2] ?? null;
  }
};

/** Всё, что ушло в консоль (логгер пишет JSON-строки через console.*) с уровнем debug. */
function captureLogs() {
  process.env.LOG_LEVEL = "debug";
  const lines: string[] = [];
  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => void lines.push(args.map(String).join(" ")));
  }
  return lines;
}

const setPayoutCalls = () => identityFake.calls.filter((c) => c.method === "setPayoutIban");
const submitKycCalls = () => identityFake.calls.filter((c) => c.method === "submitKyc");

describe("пределы схем v2 совпадают с модулями", () => {
  it("«О себе», плата за выезд, число файлов", () => {
    expect(ABOUT_MAX).toBe(ABOUT_MAX_LENGTH);
    expect(FEE_MIN).toBe(MEASUREMENT_FEE_MIN);
    expect(FEE_MAX).toBe(MEASUREMENT_FEE_MAX);
    expect(KYC_MAX).toBe(KYC_MAX_FILES);
  });
});

describe("«Компания»", () => {
  it("одобренный мастер: «как вас видят», публичная страница, разделы, одно главное действие, «Назад» — «Профиль»", async () => {
    const executor = await master({ legalName: "ИП «Дала»" });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await renderCompany();
      expect(out).toContain(m.company.now.APPROVED.title);
      expect(out).toContain(ru.common.executorLabel(executor.executor.publicNumber));
      expect(out).toContain("ИП «Дала»");
      expect(out).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
      for (const href of ["/v2/executor/profile/kyc", "/v2/executor/profile/payout", "/v2/executor/portfolio", "/v2/executor/finance"]) {
        expect(out).toContain(`href="${href}"`);
      }
      expect(out).toContain('href="/v2/profile"');
      expect(out).toContain(m.company.form.about.explain.label);
      expect(h1(out)).toBe(1);
      expect(primaries(out)).toBe(1);
      expect(out).not.toMatch(/заказчик|платформ|комисси|эскроу/i);
    }
  });

  it("мастер на проверке: заполнять можно, публичной страницы и финансов нет, «Назад» нет (вкладка)", async () => {
    await master({ status: "PENDING" });
    const out = await renderCompany();
    expect(out).toContain(m.company.now.PENDING.title);
    expect(out).toContain(m.company.form.save);
    expect(out).not.toContain("/v2/executors/");
    expect(out).not.toContain("/v2/executor/finance");
    expect(out).not.toContain('href="/v2/profile"');
    expect(out).toContain('href="/v2/executor/profile/kyc"');
  });

  it("после отказа: причина и ссылка на анкету", async () => {
    const executor = await master({ status: "REJECTED" });
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { rejectReason: "Не совпадает наименование" } });
    const out = await renderCompany();
    expect(out).toContain(m.company.now.REJECTED.reason("Не совпадает наименование"));
    expect(out).toContain('href="/v2/register/executor?step=form"');
  });

  it("покупатель без роли мастера — не здесь: уходит в свой дом", async () => {
    const client = await makeClient();
    await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(client);
    expect(await redirectOf(() => CompanyPage())).not.toBeNull();
  });
});

describe("сохранение компании", () => {
  const input = {
    about: "Делаю кухни и шкафы",
    yearsExperience: 7,
    specializationIds: [] as string[],
    measurementTerms: "FREE" as const,
    measurementFee: null,
    city: "Астана",
    district: "Есильский район",
    streetAddress: "ул. Сыганак, 10",
  };

  it("мастер на проверке сохраняет; повтор — тот же результат", async () => {
    const executor = await master({ status: "PENDING" });
    const first = await saveCompanyAction(input);
    expect(first).toEqual({ ok: true, data: { aboutMasked: false, about: "Делаю кухни и шкафы" } });
    expect(await saveCompanyAction(input)).toEqual(first);
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toMatchObject({ city: "Астана", yearsExperience: 7, district: "Есильский район" });
  });

  it("«О себе» проходит маску: телефон и ссылка убираются, признак возвращается", async () => {
    await master();
    const res = await saveCompanyAction({ ...input, about: "Звоните +7 701 123 45 67, пишите https://t.me/dala" });
    expect(res.ok && res.data.aboutMasked).toBe(true);
    expect(res.ok && res.data.about).toContain(MASK);
    expect(res.ok && res.data.about).not.toMatch(/701|t\.me/);
  });

  it("ошибки у полей: опыт, плата за выезд, город; в профиле ничего не меняется", async () => {
    const executor = await master();
    const before = await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } });
    const bad = await saveCompanyAction({ ...input, yearsExperience: 99, city: "", measurementTerms: "FEE_IF_NO_DEAL", measurementFee: 5 });
    expect(bad).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: {
        yearsExperience: [m.company.form.errors.experience],
        city: [m.company.form.errors.city],
        measurementFee: [m.company.form.errors.fee(FEE_MIN, FEE_MAX)],
      },
    });
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toEqual(before);
  });

  it("неизвестный тип мебели — отказ у поля со своим текстом", async () => {
    await master();
    expect(await saveCompanyAction({ ...input, specializationIds: ["нет-такого"] })).toMatchObject({
      ok: false,
      fieldErrors: { specializationIds: [m.company.form.errors.unknownType] },
    });
  });

  it("покупатель не сохраняет компанию", async () => {
    const client = await makeClient();
    await signInAs(client);
    expect(await saveCompanyAction(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("«Проверка документов»", () => {
  it("не поданы: форма и одно главное действие; фото и PDF, камера на телефоне", async () => {
    await master({ status: "PENDING" });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(KycPage);
      expect(out).toContain(m.kyc.status.NOT_SUBMITTED);
      expect(out).toContain(m.kyc.form.id);
      expect(out).toContain(m.kyc.form.registration);
      expect(out).toContain("application/pdf");
      expect(out).toContain(m.kyc.form.submit);
      expect(out).toContain('href="/v2/executor/profile"');
      expect(h1(out)).toBe(1);
      expect(primaries(out)).toBe(1);
    }
  });

  it("отправка: статус «на проверке», число файлов, формы нет; «заново» открывает её; повтор тех же файлов — отказ без второго вызова", async () => {
    const executor = await master();
    const files = { idFileIds: [await makePhoto(executor, "KYC_ID")], registrationFileIds: [await makePhoto(executor, "KYC_REGISTRATION")] };
    expect(await submitKycAction(files)).toEqual({ ok: true, data: undefined });
    expect(submitKycCalls()).toHaveLength(1);

    const pending = await render(KycPage);
    expect(pending).toContain(m.kyc.status.PENDING);
    expect(pending).toContain("Отправлено: 2 файла");
    expect(pending).not.toContain(m.kyc.form.submit);
    expect(pending).toContain(`href="/v2/executor/profile/kyc?again=1"`);
    expect(primaries(pending)).toBe(0);
    expect(await render(KycPage, { again: "1" })).toContain(m.kyc.form.submit);

    // Повторная отправка тех же файлов (двойной клик, вторая вкладка): отказ, identity больше не вызывается.
    expect(await submitKycAction(files)).toMatchObject({ ok: false, error: m.kyc.form.errors.alreadySent });
    expect(submitKycCalls()).toHaveLength(1);

    // Новые файлы после «заново» принимаются: документы на проверке можно заменить.
    const again = { idFileIds: [await makePhoto(executor, "KYC_ID")], registrationFileIds: [await makePhoto(executor, "KYC_REGISTRATION")] };
    expect(await submitKycAction(again)).toEqual({ ok: true, data: undefined });
    expect(submitKycCalls()).toHaveLength(2);
  });

  it("отказ: причина на экране, форма открыта сразу", async () => {
    const executor = await master({ status: "PENDING" });
    identityFake.setKycStatus(executor.id, KycStatus.REJECTED, { reason: "Фото нечёткое" });
    const out = await render(KycPage);
    expect(out).toContain(m.kyc.now.REJECTED.reason("Фото нечёткое"));
    expect(out).toContain(m.kyc.form.submit);
  });

  it("проверены: формы и главного действия нет", async () => {
    const executor = await master();
    identityFake.setKycStatus(executor.id, KycStatus.VERIFIED);
    const out = await render(KycPage);
    expect(out).toContain(m.kyc.status.VERIFIED);
    expect(out).not.toContain(m.kyc.form.submit);
    expect(primaries(out)).toBe(0);
  });

  it("чужие файлы — отказ, identity не вызывается, чужой файл не прикреплён", async () => {
    const executor = await master();
    const other = await makeExecutor();
    const foreign = await makePhoto(other, "KYC_ID");
    const own = await makePhoto(executor, "KYC_REGISTRATION");
    expect(await submitKycAction({ idFileIds: [foreign], registrationFileIds: [own] })).toMatchObject({ ok: false, error: m.kyc.form.errors.alreadySent });
    expect(submitKycCalls()).toHaveLength(0);
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: foreign } })).executorProfileId).toBeNull();
    // Транзакция откатилась целиком: и свой файл остался неприкреплённым.
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: own } })).executorProfileId).toBeNull();
  });

  it("файл чужого назначения (фото портфолио) — отказ", async () => {
    const executor = await master();
    const portfolio = await makePhoto(executor, "PORTFOLIO");
    const reg = await makePhoto(executor, "KYC_REGISTRATION");
    expect(await submitKycAction({ idFileIds: [portfolio], registrationFileIds: [reg] })).toMatchObject({ ok: false, error: m.kyc.form.errors.alreadySent });
    expect(submitKycCalls()).toHaveLength(0);
  });

  it("пустой раздел, больше четырёх файлов, не UUID — ошибки у разделов", async () => {
    const executor = await master();
    const reg = await makePhoto(executor, "KYC_REGISTRATION");
    expect(await submitKycAction({ idFileIds: [], registrationFileIds: [reg] })).toMatchObject({ ok: false, fieldErrors: { idFileIds: [m.kyc.form.errors.needId] } });
    const five = await Promise.all([1, 2, 3, 4, 5].map(() => makePhoto(executor, "KYC_ID")));
    expect(await submitKycAction({ idFileIds: five, registrationFileIds: [reg] })).toMatchObject({ ok: false, fieldErrors: { idFileIds: [m.kyc.form.errors.limit(4)] } });
    expect(await submitKycAction({ idFileIds: ["старый-id"], registrationFileIds: [reg] })).toMatchObject({ ok: false });
    expect(submitKycCalls()).toHaveLength(0);
  });

  it("покупатель не отправляет документы", async () => {
    const client = await makeClient();
    await signInAs(client);
    expect(await submitKycAction({ idFileIds: [crypto.randomUUID()], registrationFileIds: [crypto.randomUUID()] })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("«Счёт для оплаты»", () => {
  it("не указан: форма, «Не указан», одно главное действие; полного номера нигде нет", async () => {
    await master({ status: "PENDING" });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await renderPayout();
      expect(out).toContain(m.payout.now.none.title);
      expect(out).toContain(m.payout.none);
      expect(out).toContain(m.payout.form.save);
      expect(h1(out)).toBe(1);
      expect(primaries(out)).toBe(1);
      expect(out).not.toMatch(/выплат|договор/i);
    }
  });

  it("сохранение: в ответе и на экране только последние 4 знака; номер не попадает в журнал", async () => {
    const executor = await master({ status: "PENDING" });
    const logs = captureLogs();
    const bad = await savePayoutAction({ iban: "KZ87 125K ZT50 0410 0100" });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { iban: [m.payout.form.errors.checksum] } });

    const saved = await savePayoutAction({ iban: GROUPED });
    expect(saved).toEqual({ ok: true, data: { last4: "0100" } });
    expect(JSON.stringify(saved)).not.toContain("KZ86");
    expect(setPayoutCalls()).toHaveLength(1);
    expect((await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).payoutIbanLast4).toBe("0100");

    const out = await renderPayout();
    expect(out).toContain("KZ •••• 0100");
    expect(out).toContain(m.payout.now.set.title);
    for (const secret of [IBAN, GROUPED, "125KZT", "5004100"]) expect(out).not.toContain(secret);
    expect(logs.filter((line) => line.includes("86125") || line.includes("5004100"))).toEqual([]);
  });

  it("оплата в обработке: смена — отказ со своим текстом, identity не вызывается; экран без формы и с объяснением", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);

    const res = await savePayoutAction({ iban: IBAN });
    expect(res).toMatchObject({ ok: false, code: "VALIDATION", error: m.payout.form.errors.locked, fieldErrors: { iban: [m.payout.form.errors.locked] } });
    expect(JSON.stringify(res)).not.toMatch(/выплат/i);
    expect(setPayoutCalls()).toHaveLength(0);
    expect((await db.executorProfile.findUniqueOrThrow({ where: { id: f.executor.executor.id } })).payoutIbanLast4).toBeNull();

    const out = await renderPayout();
    expect(out).toContain(m.payout.now.locked.title);
    expect(out).not.toContain('name="iban"');
    expect(out).not.toContain(m.payout.form.save);
    expect(out).toContain("mailto:");
    expect(primaries(out)).toBe(0);
  });

  it("покупатель не сохраняет счёт", async () => {
    const client = await makeClient();
    await signInAs(client);
    expect(await savePayoutAction({ iban: IBAN })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(setPayoutCalls()).toHaveLength(0);
  });
});
