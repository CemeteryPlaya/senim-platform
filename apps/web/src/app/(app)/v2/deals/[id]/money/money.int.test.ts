import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { cancelDeal, openDispute, processDealMoney } from "@/modules/deal-core";
import { listDealDocuments, openSharedDocument } from "@/modules/documents";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../test/factories";
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

describe("история денег совпадает с журналом", () => {
  async function check(dealId: string, clientId: string) {
    const out = await page(dealId);
    const journal = (await journalOf(dealId)).filter((e) => e.type !== "RELEASE");
    expect(timelineItems(out)).toBe(journal.length);
    const text = plain(out);
    for (const entry of journal) expect(text).toContain(money(entry.amountTiyn));
    expect(text).not.toMatch(FORBIDDEN);
    void clientId;
    return { out, journal };
  }

  it("оплачена: одна запись HOLD — одна строка с суммой", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const { out, journal } = await check(f.dealId, client.id);
    expect(journal.map((e) => e.type)).toEqual(["HOLD"]);
    expect(plain(out)).toContain(t.type.HOLD);
    expect(plain(out)).toContain(ru.app.deal.card.money.protected.title);
  });

  it("завершена: оплата, выплата мастеру и защита сделки — каждая запись своей строкой", async () => {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await signInAs(client);
    const { out, journal } = await check(f.dealId, client.id);
    expect(journal.map((e) => e.type).sort()).toEqual(["HOLD", "SPLIT_MASTER", "SPLIT_PLATFORM"]);
    expect(plain(out)).toContain(t.type.SPLIT_MASTER);
    expect(plain(out)).toContain(t.type.SPLIT_PLATFORM);
    expect(plain(out)).toContain(t.note.SPLIT_PLATFORM);
  });

  it("возврат после отмены: оплата и возврат; блок денег «вернулись»", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await cancelDeal(client, { dealId: f.dealId });
    await processDealMoney(f.dealId);
    await signInAs(client);
    const { out, journal } = await check(f.dealId, client.id);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "REFUND"]);
    expect(plain(out)).toContain(t.type.REFUND);
    expect(plain(out)).toContain(ru.app.deal.card.money.refunded.done);
  });

  it("спор: заморозка выплаты — отдельная строка", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await openDispute(client, { dealId: f.dealId, reason: "OTHER", description: "Мастер не выходит на связь неделю" });
    await signInAs(client);
    const { out, journal } = await check(f.dealId, client.id);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "FREEZE"]);
    expect(plain(out)).toContain(t.type.FREEZE);
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
