import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import { cancelDeal } from "@/modules/deal-core";
import { computeDealMoney } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../../../test/factories";
import { dealAt, makeDeal, PRICE, signContract } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import PayPage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, push: () => undefined }) }));

const t = ru.app.deal.pay;
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|отклик/i;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function buyer() {
  const client = await makeClient("Сапарова Айгерим Ержановна");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

/** Оферта заключена; согласия на передачу банку — только у перечисленных сторон. */
async function signed(bankConsents: readonly ("CLIENT" | "EXECUTOR")[]) {
  const client = await buyer();
  const f = await makeDeal({ client, bankConsents });
  await signContract(f.dealId);
  await signInAs(client);
  return f;
}

const render = async (id: string) => renderToStaticMarkup(await PayPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest || "error";
  }
}
const redirectTo = (href: string) => expect.stringMatching(new RegExp(`^NEXT_REDIRECT;[a-z]+;${href.replace(/[/?]/g, "\\$&")};`));

const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
const shown = (out: string) => plain(out).replaceAll("Тестовый заказ", "");
const primaries = (out: string) => [...out.matchAll(/<button[^>]*data-primary-action[^>]*>([\s\S]*?)<\/button>/g)].map((m) => ({ tag: m[0], text: plain(m[1] ?? "").trim() }));

describe("экран оплаты", () => {
  it("согласие ещё не дано: смета модуля, «Где будут деньги», текст согласия с отметкой; «Оплатить N ₸» отключена с причиной", async () => {
    const f = await signed(["EXECUTOR"]);
    const out = await render(f.dealId);
    const m = computeDealMoney(PRICE);
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(`>${t.title}<`);
    expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
    for (const sum of [m.priceTiyn, m.protectionTiyn, m.buyerTotalTiyn]) expect(plain(out)).toContain(money(sum));
    expect(plain(out)).toContain(t.money.protection);
    expect(plain(out)).toContain(t.money.explain.label);
    expect(plain(out)).toContain(t.where.section);
    expect(plain(out)).toContain(ru.consent.documents.BANK_TRANSFER.title);
    expect(plain(out)).toContain(t.consent.scrollHint);
    expect(plain(out)).toContain(t.consent.agree);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]?.text).toContain(money(m.buyerTotalTiyn));
    expect(primaries(out)[0]?.tag).toMatch(/\sdisabled=""/);
    expect(plain(out)).toContain(t.disabledReason);
    expect(shown(out)).not.toMatch(FORBIDDEN);
  });

  it("согласие уже дано: «Согласие дано» без отметки, «Оплатить N ₸» доступна", async () => {
    const f = await signed(["CLIENT", "EXECUTOR"]);
    const out = await render(f.dealId);
    expect(plain(out)).toContain(t.consent.given);
    expect(plain(out)).not.toContain(t.consent.agree);
    expect(primaries(out)).toHaveLength(1);
    expect(primaries(out)[0]?.text).toBe(t.submit(formatMoney(computeDealMoney(PRICE).buyerTotalTiyn)));
    expect(primaries(out)[0]?.tag).not.toMatch(/\sdisabled=""/);
  });

  it("мастер не дал согласие: чего ждём, главной кнопки нет; своё — «Дать согласие заранее» второстепенной кнопкой", async () => {
    const f = await signed([]);
    const out = await render(f.dealId);
    expect(plain(out)).toContain(t.waitMaster.title);
    expect(primaries(out)).toHaveLength(0);
    expect(plain(out)).toContain(t.consent.giveAhead);
    expect(plain(out)).toContain(t.consent.agree);
    const given = await signed(["CLIENT"]);
    const out2 = await render(given.dealId);
    expect(plain(out2)).toContain(t.waitMaster.title);
    expect(plain(out2)).toContain(t.consent.given);
    expect(plain(out2)).not.toContain(t.consent.giveAhead);
    expect(primaries(out2)).toHaveLength(0);
  });

  it("на компьютере — две колонки, одно главное действие", async () => {
    const f = await signed(["CLIENT", "EXECUTOR"]);
    h.device = "desktop";
    const out = await render(f.dealId);
    expect(primaries(out)).toHaveLength(1);
    expect(out).toContain("desktop:grid");
  });
});

describe("ворота экрана оплаты: не шаг оплаты — карточка сделки", () => {
  it("оферта не подписана, уже оплачено, сделка отменена — на карточку сделки", async () => {
    const client = await buyer();
    await signInAs(client);
    const unsigned = await makeDeal({ client });
    expect(await outcome(() => render(unsigned.dealId))).toEqual(redirectTo(`/v2/deals/${unsigned.dealId}`));
    const paid = await dealAt("PAID_HOLD", { client });
    expect(await outcome(() => render(paid.dealId))).toEqual(redirectTo(`/v2/deals/${paid.dealId}`));
    const cancelled = await dealAt("SIGNED", { client });
    await cancelDeal(client, { dealId: cancelled.dealId });
    expect(await outcome(() => render(cancelled.dealId))).toEqual(redirectTo(`/v2/deals/${cancelled.dealId}`));
  });

  it("manual: оплата ждёт банк — на карточку сделки («Ждём подтверждения оплаты»), второй оплаты нет", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client, provider: "manual" });
    const { payForDeal } = await import("@/modules/deal-core");
    await payForDeal(f.client, { dealId: f.dealId });
    await signInAs(client);
    expect(await outcome(() => render(f.dealId))).toEqual(redirectTo(`/v2/deals/${f.dealId}`));
  });

  it("чужая сделка — 404; мастер и оператор — карточка сделки v1", async () => {
    const f = await signed(["CLIENT", "EXECUTOR"]);
    await signInAs(await buyer());
    expect(await outcome(() => render(f.dealId))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);
    // Мастер, прошедший первые шаги: иначе ворота уведут его на шаг онбординга раньше развилки ролей.
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor);
    expect(await outcome(() => render(f.dealId))).toEqual(redirectTo(`/deals/${f.dealId}`));
    await signInAs(await makeOperator());
    expect(await outcome(() => render(f.dealId))).toEqual(redirectTo(`/deals/${f.dealId}`));
  });
});
