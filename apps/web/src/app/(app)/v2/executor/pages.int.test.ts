import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { sendOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeUser } from "../../../../../test/factories";
import { freshBrowser } from "../../../../../test/factories/identity";
import { makeOpenRequest, offerInput } from "../../../../../test/factories/requests";
import { signInAs } from "../../../../../test/factories/session";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const { default: IncomingPage } = await import("./requests/(list)/page");
const { default: OffersPage } = await import("./offers/page");
const { default: FinancePage } = await import("./finance/page");
const { default: PortfolioPage } = await import("./portfolio/page");
const { default: NewWorkPage } = await import("./portfolio/new/page");
const { default: DealsPage } = await import("../deals/(list)/page");

const m = ru.app.masterRequests;
type Params = Record<string, string>;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function master(opts: Parameters<typeof makeExecutor>[0] = {}) {
  const executor = await makeExecutor(opts);
  await db.user.update({ where: { id: executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(executor);
  return executor;
}

async function render(page: (props: { searchParams: Promise<Params> }) => Promise<ReactElement>, params: Params = {}): Promise<string> {
  const element = await page({ searchParams: Promise.resolve(params) });
  return renderToStaticMarkup(element);
}

const primaries = (out: string) => out.split("data-primary-action").length - 1;

describe("«Заявки» мастера", () => {
  it("пусто — обучающий экран с одним действием", async () => {
    await master({ segment: "PREMIUM" });
    const out = await render(IncomingPage);
    expect(out).toContain(m.incoming.empty.title);
    expect(primaries(out)).toBe(1);
  });

  it("новая заявка видна в «Все» и «Новые»; прямые — отдельный чип только когда они есть; покупатель не назван", async () => {
    const client = await makeClient("Сапаров Ерлан Ержанович");
    await makeOpenRequest(client, { segment: "COMFORT" });
    await master({ segment: "COMFORT" });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const all = await render(IncomingPage);
      expect(all).toContain(m.incoming.card.fresh);
      expect(all).toContain(m.incoming.chip(m.incoming.chips.fresh, 1));
      expect(all).not.toContain(m.incoming.chips.direct);
      expect(all).not.toContain("Сапаров");
      expect(primaries(all)).toBe(0);
      expect((all.match(/<h1/g) ?? []).length).toBe(1);
    }
    // Прямых нет — чипа нет, адрес читается как «Все»: заявка на месте, активен «Все».
    const direct = await render(IncomingPage, { f: "direct" });
    expect(direct).toContain(m.incoming.card.fresh);
    expect(direct).not.toContain(m.incoming.emptyFilter.title);
  });

  it("неодобренный мастер — экран статуса вместо ошибки", async () => {
    await master({ status: "PENDING" });
    const out = await render(IncomingPage);
    expect(out).toContain(m.gate.pending.now);
    expect(out).toContain('href="/v2/register/executor"');
  });
});

describe("«Мои предложения»", () => {
  it("пусто — обучающий экран; после предложения — карточка с ценой и статусом «Ждёт ответа»", async () => {
    const executor = await master({ segment: "COMFORT" });
    expect(await render(OffersPage)).toContain(m.offers.empty.title);
    const requestId = await makeOpenRequest(await makeClient(), { segment: "COMFORT" });
    await sendOffer(executor, offerInput(requestId, 500_000));
    const out = await render(OffersPage);
    expect(out).toContain(m.offers.status.waiting);
    expect(out).toContain(`href="/v2/executor/requests/${requestId}"`);
    expect(out).toContain(m.offers.chip(m.offers.chips.waiting, 1));
    expect(await render(OffersPage, { show: "chosen" })).toContain(m.offers.emptyFilter.title);
  });

  it("неодобренный мастер — экран статуса", async () => {
    await master({ status: "REJECTED" });
    expect(await render(OffersPage)).toContain(m.gate.rejected.now);
  });
});

describe("мастер до одобрения: один дом и «Назад» на главную", () => {
  const BACK = /<a [^>]*href="\/v2\/register\/executor"[^>]*><svg[^>]*>.*?<\/svg><span class="sr-only">Назад: <\/span>Главная/;

  it.each([
    ["заявки", IncomingPage],
    ["предложения", OffersPage],
  ] as const)("«%s»: на проверке — экран статуса со строкой «Назад» на главную (регистрацию)", async (_name, page) => {
    await master({ status: "PENDING" });
    expect(await render(page)).toMatch(BACK);
  });

  it("«Сделки» без сделок: на проверке — экран статуса со строкой «Назад»", async () => {
    await master({ status: "PENDING" });
    expect(await render(DealsPage)).toMatch(BACK);
  });

  /** Куда ведёт экран: «page» — нарисовался, иначе адрес перехода. */
  async function where(page: (props: { searchParams: Promise<Params> }) => Promise<ReactElement>): Promise<string> {
    try {
      await render(page);
      return "page";
    } catch (e) {
      const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
      return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? "") : digest || "error";
    }
  }

  it.each([
    ["заявки", IncomingPage],
    ["предложения", OffersPage],
    ["финансы", FinancePage],
    ["сделки", DealsPage],
    ["портфолио", PortfolioPage],
    ["новая работа", NewWorkPage],
  ] as const)("нет профиля мастера: «%s» — переход на регистрацию, не экран статуса", async (_name, page) => {
    const user = await makeUser("EXECUTOR");
    await db.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(user);
    expect(await where(page as never)).toBe("/v2/register/executor");
  });

  it("портфолио открыто мастеру на проверке (его заполняют до проверки)", async () => {
    await master({ status: "PENDING" });
    expect(await where(PortfolioPage as never)).toBe("page");
  });
});
