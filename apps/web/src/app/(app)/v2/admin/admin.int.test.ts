import { randomUUID } from "node:crypto";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { processDealMoney } from "@/modules/deal-core";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeAdmin, makeClient, makeExecutor, makeOperator } from "../../../../../test/factories";
import { makeFurnitureType } from "../../../../../test/factories/companies";
import { makeOffer, makeRequest } from "../../../../../test/factories/operator";
import { dealAt, PRICE, signAct } from "../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import AdminRecordPage from "./data/[model]/[id]/page";
import { updateRecordAction } from "./data/[model]/[id]/actions";
import { RecordForm, type RecordFormProps } from "./data/[model]/[id]/RecordForm";
import AdminTablePage from "./data/[model]/page";
import AdminDataPage from "./data/page";
import AdminHome from "./page";

const h = vi.hoisted(() => ({ revalidated: [] as unknown[][] }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => void h.revalidated.push(args) }));
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined }) }));

const t = ru.app.admin;
const HIDDEN_NAMES = ["iinEnc", "iinHash", "iinLast4", "binIinEnc", "binIinHash", "binIinLast4", "signerIinEnc", "signerIinHash", "payoutIbanEnc", "payoutIbanLast4"];

beforeEach(() => {
  freshBrowser();
  h.revalidated.length = 0;
});

const home = (sp: Record<string, string> = {}) => AdminHome({ searchParams: Promise.resolve(sp) });
const table = (model: string, sp: Record<string, string> = {}) => AdminTablePage({ params: Promise.resolve({ model }), searchParams: Promise.resolve(sp) });
const card = (model: string, id: string) => AdminRecordPage({ params: Promise.resolve({ model, id }) });
const html = async (page: Promise<ReactNode>) => renderToStaticMarkup((await page) as ReactElement);
/** Видимый текст: без разметки, неразрывные пробелы сумм — обычными. */
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/ | /g, " ");

/** digest ошибки Next (redirect, notFound) или «page» — страница отрисовалась. */
async function outcome(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return "page";
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest === undefined) throw e;
    return digest;
  }
}
const redirectTo = async (p: Promise<unknown>) => (await outcome(p)).split(";")[2] ?? null;

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  return [node, ...elements((node.props as { children?: ReactNode }).children)];
}

/** Мастер с заметными значениями скрытых полей (как в read.int.test.ts модуля). */
async function executorWithSecrets() {
  const executor = await makeExecutor({ legalName: "ИП Секретов" });
  const tag = randomUUID().slice(0, 8);
  const secrets = {
    iinEnc: `ENC-IIN-${tag}`,
    iinHash: `HASH-IIN-${tag}`,
    iinLast4: "Щ1Щ2",
    binIinEnc: `ENC-BIN-${tag}`,
    binIinHash: `HASH-BIN-${tag}`,
    binIinLast4: "Ж3Ж4",
    signerIinEnc: `ENC-SIGNER-${tag}`,
    signerIinHash: `HASH-SIGNER-${tag}`,
    payoutIbanEnc: `ENC-IBAN-${tag}`,
    payoutIbanLast4: "Ы5Ы6",
  };
  await db.user.update({ where: { id: executor.id }, data: { iinEnc: secrets.iinEnc, iinHash: secrets.iinHash, iinLast4: secrets.iinLast4 } });
  const { binIinEnc, binIinHash, binIinLast4, signerIinEnc, signerIinHash, payoutIbanEnc, payoutIbanLast4 } = secrets;
  await db.executorProfile.update({
    where: { id: executor.executor.id },
    data: { binIinEnc, binIinHash, binIinLast4, signerIinEnc, signerIinHash, payoutIbanEnc, payoutIbanLast4 },
  });
  return { executor, secrets: Object.values(secrets) };
}

function expectNoSecrets(text: string, secrets: readonly string[]) {
  for (const name of HIDDEN_NAMES) expect(text, name).not.toContain(name);
  for (const value of secrets) expect(text, value).not.toContain(value);
}

describe("админка: ворота экранов", () => {
  const pages: Record<string, () => Promise<unknown>> = {
    "/v2/admin": () => home(),
    "/v2/admin/data": () => AdminDataPage(),
    "/v2/admin/data/User": () => table("User"),
    "/v2/admin/data/User/u1": () => card("User", "u1"),
  };

  it.each(Object.keys(pages))("%s: гость — на вход; оператор и покупатель — в свой дом; администратор без второго шага — экран кода", async (path) => {
    const open = pages[path];
    expect(await redirectTo(open())).toMatch(/^\/v2\/login/);

    await signInAs(await makeOperator());
    expect(await redirectTo(open())).toBe("/v2/operator");

    freshBrowser();
    await signInAs(await makeClient());
    expect(await redirectTo(open())).not.toMatch(/^\/v2\/admin/);

    freshBrowser();
    await signInAs(await makeAdmin(), undefined, { mfaVerifiedAt: null });
    expect(await redirectTo(open())).toBe(`/v2/operator/mfa?${new URLSearchParams({ next: path })}`);
  });
});

describe("админка: статистика /v2/admin", () => {
  it("деньги из журнала — суммами через formatMoney, воронка и статусы; период — ссылками, выбран из адреса", async () => {
    const f = await dealAt("READY");
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await signInAs(await makeAdmin());
    const split = computeDealMoney(PRICE);

    const text = plain(await html(home()));
    for (const label of [t.stats.money.paid, t.stats.money.payout, t.stats.money.refund, t.stats.money.income, ...Object.values(t.stats.funnel.steps)]) {
      expect(text).toContain(label);
    }
    for (const tiyn of [split.buyerTotalTiyn, split.payoutTiyn, split.platformIncomeTiyn]) expect(text).toContain(money(tiyn));
    expect(text).toContain("SPLIT_PAYOUT");

    const week = await html(home({ period: "7d" }));
    const active = (out: string) => [...out.matchAll(/aria-current="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(active(week)).toEqual([t.stats.period["7d"]]);
    expect(week).toContain('href="/v2/admin?period=all"');
    // Без параметра и с неизвестным периодом — 30 дней, без ошибки.
    expect(active(await html(home()))).toEqual([t.stats.period["30d"]]);
    expect(active(await html(home({ period: "1y" })))).toEqual([t.stats.period["30d"]]);
  });
});

describe("админка: данные", () => {
  it("список моделей — имя, число записей, «только чтение»", async () => {
    await makeFurnitureType({ name: "Кухня" });
    await signInAs(await makeAdmin());
    const out = await html(AdminDataPage());
    expect(out).toContain('href="/v2/admin/data/FurnitureType"');
    expect(out).toContain('href="/v2/admin/data/MoneyTransaction"');
    expect(out).toContain(t.data.readonly);
  });

  it("таблица: строки со ссылкой на карточку, поиск и фильтр из адреса; скрытый фильтр — сообщение; неизвестная таблица — 404", async () => {
    const kitchen = await makeFurnitureType({ name: "Кухня угловая" });
    const hall = await makeFurnitureType({ name: "Прихожая" });
    await db.furnitureType.update({ where: { id: hall.id }, data: { active: false } });
    await signInAs(await makeAdmin());

    const all = await html(table("FurnitureType"));
    expect(all).toContain(`href="/v2/admin/data/FurnitureType/${kitchen.id}"`);
    expect(all).toContain(`href="/v2/admin/data/FurnitureType/${hall.id}"`);
    expect(all).toContain("f.active=false");

    const found = await html(table("FurnitureType", { q: "углов" }));
    expect(found).toContain(kitchen.id);
    expect(found).not.toContain(hall.id);
    const hidden = await html(table("FurnitureType", { "f.active": "false" }));
    expect(hidden).toContain(hall.id);
    expect(hidden).not.toContain(kitchen.id);

    const leak = plain(await html(table("ExecutorProfile", { "f.binIinHash": "x" })));
    expect(leak).toContain(t.data.errors.filter);
    expect(await outcome(table("Nope"))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);

    // Переход из карточки по связи «много»: только записи этой заявки и плашка со ссылкой на всю таблицу.
    const request = await makeRequest();
    const mine = await makeOffer(request.id);
    const other = await makeOffer((await makeRequest()).id);
    const related = await html(table("Offer", { where: "requestId", value: request.id }));
    expect(related).toContain(mine.id);
    expect(related).not.toContain(other.id);
    expect(plain(related)).toContain(t.data.relation("requestId", request.id));
    expect(related).toContain('href="/v2/admin/data/Offer"');
    expect(plain(await html(table("Offer", { where: "binIinHash", value: "x" })))).toContain(t.data.errors.relation);
  });

  it("таблица и карточка ExecutorProfile: ни имён, ни значений скрытых полей — в HTML и в данных формы (RSC)", async () => {
    const { executor, secrets } = await executorWithSecrets();
    await signInAs(await makeAdmin());

    expectNoSecrets(await html(table("ExecutorProfile")), secrets);
    expectNoSecrets(await html(table("User")), secrets);
    // Поиск по значению скрытого поля ничего не находит (сам запрос остаётся в поле поиска — это ввод человека).
    for (const q of secrets) expect(plain(await html(table("ExecutorProfile", { q }))), q).toContain(t.data.total(0));

    const tree = await card("ExecutorProfile", executor.executor.id);
    const form = elements(tree as ReactNode).find((el) => el.type === RecordForm)?.props as RecordFormProps | undefined;
    expect(form?.row.id).toBe(executor.executor.id);
    expectNoSecrets(JSON.stringify(form), secrets);
    const out = renderToStaticMarkup(tree as ReactElement);
    expectNoSecrets(out, secrets);
    expect(out).toContain("ИП Секретов");
    // Связь «один» с пользователем — ссылка на его карточку, «много» — на отфильтрованный список.
    expect(out).toContain(`href="/v2/admin/data/User/${executor.id}"`);
    expect(out).toContain(`href="/v2/admin/data/Offer?where=executorId&amp;value=${executor.executor.id}"`);

    expectNoSecrets(await html(card("User", executor.id)), secrets);
    expect(await outcome(card("ExecutorProfile", "нет-такой"))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
    expect(await outcome(card("Nope", "x"))).toMatch(/^NEXT_HTTP_ERROR_FALLBACK;404/);
  });
});

describe("админка: правка записи updateRecordAction", () => {
  const audit = () => db.auditEvent.count({ where: { action: "admin.record.updated" } });

  it("не администратор — FORBIDDEN, без второго шага — MFA_REQUIRED; ничего не меняется", async () => {
    const type = await makeFurnitureType({ name: "Кухня" });
    const input = { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] };
    for (const user of [await makeOperator(), await makeClient()]) {
      freshBrowser();
      await signInAs(user);
      expect(await updateRecordAction(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    freshBrowser();
    await signInAs(await makeAdmin(), undefined, { mfaVerifiedAt: null });
    expect(await updateRecordAction(input)).toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухня");
    expect(await audit()).toBe(0);
  });

  it("подмена модели или поля — FORBIDDEN текстом админки, без изменения и без аудита", async () => {
    const f = await dealAt("PAID_HOLD");
    const op = await db.moneyTransaction.findFirstOrThrow({ where: { dealId: f.dealId } });
    const { executor } = await executorWithSecrets();
    const type = await makeFurnitureType({ name: "Кухня" });
    await signInAs(await makeAdmin());
    const before = JSON.stringify([await db.moneyTransaction.findMany(), await db.deal.findMany(), await db.user.findMany(), await db.executorProfile.findMany(), await db.furnitureType.findMany()], (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );

    const tampered = [
      { model: "MoneyTransaction", id: op.id, changes: [{ field: "status", from: "SUCCEEDED", to: "FAILED" }] },
      { model: "Deal", id: f.dealId, changes: [{ field: "status", from: "PAID_HOLD", to: "SPLIT_PAYOUT" }] },
      { model: "User", id: executor.id, changes: [{ field: "iinHash", from: null, to: "x" }] },
      { model: "ExecutorProfile", id: executor.executor.id, changes: [{ field: "binIinHash", from: null, to: "x" }] },
      { model: "FurnitureType", id: type.id, changes: [{ field: "id", from: type.id, to: "x" }] },
      { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }, { field: "slug", from: type.slug, to: "x" }] },
      { model: "Nope", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] },
    ];
    for (const input of tampered) {
      const result = await updateRecordAction(input);
      expect(result, `${input.model}.${input.changes.at(-1)?.field}`).toEqual({ ok: false, code: "FORBIDDEN", error: t.record.errors.forbidden });
    }
    const after = JSON.stringify([await db.moneyTransaction.findMany(), await db.deal.findMany(), await db.user.findMany(), await db.executorProfile.findMany(), await db.furnitureType.findMany()], (_k, v: unknown) =>
      typeof v === "bigint" ? v.toString() : v,
    );
    expect(after).toBe(before);
    expect(await audit()).toBe(0);
    expect(h.revalidated).toEqual([]);
  });

  it("неверный ввод — VALIDATION схемой: лишний ключ, пустые правки, длинное значение, объект вместо строки", async () => {
    const type = await makeFurnitureType({ name: "Кухня" });
    await signInAs(await makeAdmin());
    const ok = { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] };
    const bad: unknown[] = [
      { ...ok, extra: 1 },
      { ...ok, changes: [] },
      { ...ok, changes: [{ field: "name", from: "Кухня", to: "Кухни", extra: 1 }] },
      { ...ok, changes: [{ field: "name", from: "Кухня", to: "x".repeat(10_001) }] },
      { ...ok, changes: [{ field: "name", from: { not: "" }, to: "Кухни" }] },
      { ...ok, model: "x".repeat(65) },
      { ...ok, id: "" },
      { ...ok, changes: Array.from({ length: 51 }, () => ok.changes[0]) },
    ];
    for (const input of bad) {
      expect(await updateRecordAction(input as Parameters<typeof updateRecordAction>[0])).toMatchObject({ ok: false, code: "VALIDATION" });
    }
    // Значение не по типу поля — ошибка у поля из модуля.
    expect(await updateRecordAction({ ...ok, changes: [{ field: "sortOrder", from: String(type.sortOrder), to: "много" }] })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { sortOrder: [t.record.errors.int] },
    });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухня");
    expect(await audit()).toBe(0);
  });

  it("правка применяется с аудитом и обновляет карточку; повтор с прежним from — CONFLICT текстом админки", async () => {
    const type = await makeFurnitureType({ name: "Кухня" });
    await signInAs(await makeAdmin());
    const input = { model: "FurnitureType", id: type.id, changes: [{ field: "name", from: "Кухня", to: "Кухни" }] };

    expect(await updateRecordAction(input)).toEqual({ ok: true, data: { changed: 1 } });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухни");
    expect(await audit()).toBe(1);
    expect(h.revalidated).toEqual([[`/v2/admin/data/FurnitureType/${type.id}`]]);

    expect(await updateRecordAction({ ...input, changes: [{ field: "name", from: "Кухня", to: "Кухня новая" }] })).toEqual({ ok: false, code: "CONFLICT", error: t.record.conflict });
    expect((await db.furnitureType.findUniqueOrThrow({ where: { id: type.id } })).name).toBe("Кухни");
    expect(await audit()).toBe(1);

    // Без изменений — успех без аудита и без обновления экрана.
    h.revalidated.length = 0;
    expect(await updateRecordAction({ ...input, changes: [{ field: "name", from: "Кухни", to: "Кухни" }] })).toEqual({ ok: true, data: { changed: 0 } });
    expect(h.revalidated).toEqual([]);
    expect(await audit()).toBe(1);

    // Карточка после правки — новое значение в форме.
    const tree = await card("FurnitureType", type.id);
    const form = elements(tree as ReactNode).find((el) => el.type === RecordForm)?.props as RecordFormProps | undefined;
    expect(form?.row.name).toBe("Кухни");
    expect(form?.fields.find((f) => f.name === "name")?.access).toBe("editable");
  });
});
