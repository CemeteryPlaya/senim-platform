import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { cancelDeal, openDispute, processDealMoney, resolveDispute } from "@/modules/deal-core";
import { listDealDocuments, openSharedDocument } from "@/modules/documents";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../../../test/factories";
import { dealAt, journalOf, signAct } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { shareDocumentAction } from "./actions";
import MoneyPage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined }) }));

const t = ru.app.deal.money;
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ/i;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function buyer(name = "Сапаров Ерлан Ержанович") {
  const client = await makeClient(name);
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

const page = async (id: string) => renderToStaticMarkup(await MoneyPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replaceAll("Тестовый заказ", "").replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
const timelineItems = (out: string) => (out.match(new RegExp(`<ol aria-label="${t.operationsLabel}"[\\s\\S]*?</ol>`))?.[0].match(/<li/g) ?? []).length;

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

/** Суммы вида «96 000 ₸» из видимого текста (без дат и номеров). */
const amountsIn = (text: string) => (text.match(/\d[\d ]* ₸/g) ?? []).map((x) => x.trim());

describe("история денег покупателя совпадает с журналом: только движение его денег", () => {
  /** Каждая запись журнала показана своей строкой или свёрнута в строку завершения; суммы показанных строк равны записям. */
  async function check(dealId: string) {
    const out = await page(dealId);
    const text = plain(out);
    const journal = (await journalOf(dealId)).filter((e) => e.type !== "RELEASE");
    const split = journal.filter((e) => e.type === "SPLIT_MASTER" || e.type === "SPLIT_PLATFORM");
    const shown = journal.filter((e) => !split.includes(e));
    expect(timelineItems(out)).toBe(shown.length + (split.length > 0 ? 1 : 0));
    const shownWithAmount = shown.filter((e) => e.type === "HOLD" || e.type === "REFUND");
    for (const entry of shownWithAmount) expect(amountsIn(text)).toContain(money(entry.amountTiyn));
    // Доля мастера, доход сервиса и «4%» покупателю не показываются.
    for (const entry of [...split, ...journal.filter((e) => e.type === "FREEZE" || e.type === "UNFREEZE")]) {
      if (!shownWithAmount.some((s) => s.amountTiyn === entry.amountTiyn)) expect(amountsIn(text)).not.toContain(money(entry.amountTiyn));
    }
    expect(text).not.toMatch(/4%|гарантия оплаты|Гарантия оплаты|доход/i);
    expect(text).not.toMatch(FORBIDDEN);
    return { out, text, journal };
  }

  it("оплачена: одна запись HOLD — одна строка с суммой", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD"]);
    expect(text).toContain(t.type.HOLD);
    expect(text).toContain(ru.app.deal.card.money.protected.title);
  });

  it("завершена: оплата и ОДНА свёрнутая строка «Оплата переведена мастеру» без суммы", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await signInAs(client);
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type).sort()).toEqual(["HOLD", "SPLIT_MASTER", "SPLIT_PLATFORM"]);
    expect(text).toContain(t.payout);
    expect(text).not.toContain("Банк выплатил мастеру");
    // Суммы выплаты мастеру (X − 4%) и дохода сервиса нет нигде в HTML.
    const master = journal.find((e) => e.type === "SPLIT_MASTER");
    const platform = journal.find((e) => e.type === "SPLIT_PLATFORM");
    expect(amountsIn(text)).not.toContain(money(master?.amountTiyn ?? 0n));
    expect(amountsIn(text)).not.toContain(money(platform?.amountTiyn ?? 0n));
  });

  it("возврат после отмены: оплата и «Деньги возвращены вам» с суммой", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await cancelDeal(client, { dealId: f.dealId });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "REFUND"]);
    expect(text).toContain(t.type.REFUND);
    expect(text).toContain(ru.app.deal.card.money.refunded.done);
  });

  it("спор: остановка выплаты — строка без суммы (сумма записи — доля мастера)", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await openDispute(client, { dealId: f.dealId, reason: "OTHER", description: "Мастер не выходит на связь неделю" });
    await signInAs(client);
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "FREEZE"]);
    expect(text).toContain(t.type.FREEZE);
  });

  it("раздел по спору: «Спор решён: возвращено вам» с суммой возврата и «Остальное переведено мастеру» без суммы", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    const { disputeId } = await openDispute(client, { dealId: f.dealId, reason: "QUALITY", description: "Фасады не совпадают с договором" });
    await resolveDispute(await makeOperator(), { disputeId, outcome: "PARTIAL_SPLIT", masterShareTiyn: 60_000_00n, rationale: "Решение принято по материалам спора" });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const { text, journal } = await check(f.dealId);
    expect(text).toContain(t.refundSplit);
    expect(text).toContain(t.payoutRest);
    expect(journal.some((e) => e.type === "REFUND")).toBe(true);
  });

  it("до оплаты: журнал пуст — «движений нет»", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client });
    await signInAs(client);
    const out = await page(f.dealId);
    expect(plain(out)).toContain(t.empty);
    expect(timelineItems(out)).toBe(0);
  });
});

describe("страница: доступ, документы, «Назад»", () => {
  it("«Назад: <название сделки>», один h1, на компьютере тоже", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await page(f.dealId);
      expect([...out.matchAll(/<h1/g)]).toHaveLength(1);
      expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
      expect(out).toContain(`${ru.app.kit.back}: </span>`);
    }
  });

  it("выписка: «Открыть выписку» и «Поделиться»; оферты в списке нет", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const out = await page(f.dealId);
    expect(plain(out)).toContain(t.openStatement);
    expect(plain(out)).toContain(t.share);
    expect(plain(out)).not.toContain(ru.app.deal.card.documents.kinds.CONTRACT);
  });

  it("чужая и несуществующая сделка — 404", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(await buyer("Иванов Пётр Иванович"));
    expect(await outcome(() => page(f.dealId))).toContain("404");
    expect(await outcome(() => page("net-takoj"))).toContain("404");
  });

  it("гость — на вход", async () => {
    const f = await dealAt("PAID_HOLD");
    expect(await outcome(() => page(f.dealId))).toContain("/v2/login");
  });
});

describe("shareDocumentAction", () => {
  it("выписка: ссылка на экран v2, действует до срока, открывается без входа", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const statement = (await listDealDocuments(client, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT");
    expect(statement).toBeDefined();
    const result = await shareDocumentAction({ documentId: statement?.id ?? "" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.data.url);
    expect(url.pathname.startsWith("/v2/d/")).toBe(true);
    const token = decodeURIComponent(url.pathname.slice("/v2/d/".length));
    const shared = await openSharedDocument(token);
    expect(shared?.kind).toBe("MONEY_STATEMENT");
    expect(result.data.expires).not.toBe("");
  });

  it("оферту переслать нельзя; чужой документ — отказ", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const contract = (await listDealDocuments(client, f.dealId)).find((d) => d.kind === "CONTRACT");
    expect((await shareDocumentAction({ documentId: contract?.id ?? "" })).ok).toBe(false);
    const statement = (await listDealDocuments(client, f.dealId)).find((d) => d.kind === "MONEY_STATEMENT");
    await signInAs(await buyer("Иванов Пётр Иванович"));
    expect((await shareDocumentAction({ documentId: statement?.id ?? "" })).ok).toBe(false);
  });

  it("плохой вход — отказ схемы", async () => {
    await signInAs(await buyer());
    const result = await shareDocumentAction({ documentId: "" });
    expect(result.ok ? null : result.code).toBe("VALIDATION");
  });
});
