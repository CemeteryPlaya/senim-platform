import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { cancelDeal } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../../test/factories";
import { dealAt, makeDeal } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import DealPage from "../(card)/page";
import { saveDealAddressAction } from "./actions";
import AddressPage from "./page";

vi.mock("@/platform/device", () => ({ getDevice: async () => "mobile" }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, replace: () => undefined, push: () => undefined }) }));

const t = ru.app.deal;
const md = ru.app.masterDeal.card.order;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
});

async function verified(user: { id: string }) {
  await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
}

/** Сделка без адреса; покупатель (почта подтверждена) уже вошёл. */
async function buyerDeal(step: "CREATED" | "SIGNED" = "CREATED") {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await verified(client);
  const f = step === "CREATED" ? await makeDeal({ client, address: null }) : await dealAt("SIGNED", { client, address: null });
  await verified(f.executor);
  await signInAs(client);
  return f;
}

const addressPage = async (id: string) => renderToStaticMarkup(await AddressPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const cardPage = async (id: string) => renderToStaticMarkup(await DealPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

describe("saveDealAddressAction", () => {
  it("покупатель сохраняет адрес; неверный — ошибка у поля; мастер — FORBIDDEN", async () => {
    const f = await buyerDeal();
    expect(await saveDealAddressAction({ dealId: f.dealId, address: "ул. Достык, 5, кв. 12", location: { lat: 51.12, lng: 71.43 } })).toMatchObject({ ok: true });
    expect(await db.request.findUniqueOrThrow({ where: { id: f.requestId }, select: { address: true, addressLat: true } })).toEqual({ address: "ул. Достык, 5, кв. 12", addressLat: 51.12 });

    const bad = await saveDealAddressAction({ dealId: f.dealId, address: "ул", location: null });
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { address: [ru.requests.validation.dealAddressRequired] } });

    await signInAs(f.executor);
    expect(await saveDealAddressAction({ dealId: f.dealId, address: "ул. Мастера, 1", location: null })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.request.findUniqueOrThrow({ where: { id: f.requestId } })).address).toBe("ул. Достык, 5, кв. 12");
  });
});

describe("экран «Адрес сделки»", () => {
  it("покупатель: поле адреса, точка на карте, одно главное действие, «Назад» — на карточку сделки", async () => {
    const f = await buyerDeal();
    const out = await addressPage(f.dealId);
    const text = plain(out);
    for (const s of [t.address.title, t.address.field, t.address.pointLegend, t.address.findPoint, t.address.submit]) expect(text).toContain(s);
    expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
    expect(out.match(/type="submit"/g)).toHaveLength(1);
  });

  it("чужая сделка — 404; мастер сделки — на карточку; оконченная сделка — на карточку", async () => {
    const f = await buyerDeal();
    const stranger = await makeClient();
    await verified(stranger);
    await signInAs(stranger);
    expect(await outcome(() => addressPage(f.dealId))).toMatch(/NEXT_HTTP_ERROR_FALLBACK;404/);

    await signInAs(f.executor);
    expect(await outcome(() => addressPage(f.dealId))).toContain(`/v2/deals/${f.dealId}`);

    await signInAs(f.client);
    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" });
    expect(await outcome(() => addressPage(f.dealId))).toContain(`/v2/deals/${f.dealId};`);
  });
});

describe("строка «Адрес» в «Заказе»", () => {
  it("покупатель: «Не указан» и «Указать адрес»; после сохранения — адрес и «Изменить»; окончена — без ссылок", async () => {
    const f = await buyerDeal();
    let text = plain(await cardPage(f.dealId));
    expect(text).toContain(t.card.order.addressNone);
    expect(text).toContain(t.card.order.addressAdd);

    await saveDealAddressAction({ dealId: f.dealId, address: "ул. Кенесары, 40", location: null });
    const out = await cardPage(f.dealId);
    text = plain(out);
    expect(text).toContain("ул. Кенесары, 40");
    expect(text).toContain(t.card.order.addressChange);
    expect(out).toContain(`href="/v2/deals/${f.dealId}/address"`);

    await cancelDeal(f.client, { dealId: f.dealId, reason: "Передумали" });
    const ended = await cardPage(f.dealId);
    expect(plain(ended)).toContain("ул. Кенесары, 40");
    expect(ended).not.toContain(`/v2/deals/${f.dealId}/address`);
  });

  it("мастер: до оферты — только город; после — подсказка уточнить в чате, затем адрес покупателя", async () => {
    const before = await buyerDeal();
    await saveDealAddressAction({ dealId: before.dealId, address: "ул. Кенесары, 40", location: null });
    await signInAs(before.executor);
    let text = plain(await cardPage(before.dealId));
    expect(text).not.toContain("ул. Кенесары, 40");
    expect(text).not.toContain(md.addressMissing);
    expect(text).toContain(t.card.order.city);

    const signed = await buyerDeal("SIGNED");
    await signInAs(signed.executor);
    expect(plain(await cardPage(signed.dealId))).toContain(md.addressMissing);
    await signInAs(signed.client);
    await saveDealAddressAction({ dealId: signed.dealId, address: "ул. Сыганак, 12", location: null });
    await signInAs(signed.executor);
    text = plain(await cardPage(signed.dealId));
    expect(text).toContain("ул. Сыганак, 12");
    expect(text).not.toContain(md.addressMissing);
    expect(text).not.toContain(t.card.order.addressChange);
  });
});
