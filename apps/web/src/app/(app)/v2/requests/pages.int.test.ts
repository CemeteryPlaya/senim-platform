import { isRedirectError } from "next/dist/client/components/redirect-error";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/kit";
import type { CurrentUser } from "@/modules/identity";
import { sendOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../test/factories";
import { makePortfolioItem } from "../../../../../test/factories/companies";
import { makeDraft, makeFurnitureType, makeOpenRequest, offerInput } from "../../../../../test/factories/requests";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop", user: null as CurrentUser | null, asked: [] as string[] }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("@/app/(app)/_shell/auth", async (original) => ({
  ...(await original<object>()),
  requireBuyer: async (next: string) => {
    h.asked.push(next);
    return h.user!;
  },
}));

const { default: MyRequestsPage } = await import("./(list)/page");
const { default: NewRequestPage } = await import("./new/page");

const list = ru.app.requests.list;
const w = ru.app.requests.wizard;
type Params = Record<string, string>;

/** Страница → разметка, 404 или адрес перехода. */
async function render(page: (props: { searchParams: Promise<Params> }) => Promise<ReactElement | undefined>, params: Params = {}) {
  try {
    const element = await page({ searchParams: Promise.resolve(params) });
    return { html: renderToStaticMarkup(element!) };
  } catch (e) {
    if (isRedirectError(e)) return { redirect: e.digest.split(";")[2] };
    if (e instanceof Error && "digest" in e && String((e as { digest: unknown }).digest).includes("404")) return { notFound: true };
    throw e;
  }
}

const primaryCount = (html: string) => html.split("data-primary-action").length - 1;

beforeEach(async () => {
  h.device = "mobile";
  h.asked = [];
  h.user = await makeClient();
});

describe("«Мои заявки»", () => {
  it("пусто — обучающий экран с одним действием «Заказать мебель»; ворота получают адрес с параметрами", async () => {
    const { html } = await render(MyRequestsPage, { status: "draft" });
    expect(html).toContain(list.emptyTitle);
    expect(html).toContain('href="/v2/requests/new"');
    expect(primaryCount(html!)).toBe(1);
    expect(h.asked).toEqual(["/v2/requests?status=draft"]);
  });

  it("черновик ведёт в мастер, отправленная — на карточку; чужих заявок нет; одно главное действие на обоих устройствах", async () => {
    const draft = await makeDraft(h.user!);
    const sent = await makeOpenRequest(h.user!);
    const foreign = await makeDraft(await makeClient());
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const { html } = await render(MyRequestsPage);
      expect(html).toContain(`href="/v2/requests/new?draft=${draft}"`);
      expect(html).toContain(`href="/v2/requests/${sent}"`);
      expect(html).not.toContain(foreign);
      expect(html).toContain(ru.app.requests.state.draft);
      expect(html).toContain(ru.app.requests.state.waiting);
      expect(primaryCount(html!)).toBe(1);
      expect(html!.split("<h1").length - 1).toBe(1);
    }
  });
});

describe("мастер заявки", () => {
  it("новый — шаг 1 из 5, «Назад: Заявки»", async () => {
    const { html } = await render(NewRequestPage);
    expect(html).toContain(w.start.title);
    expect(html).toContain(ru.app.kit.wizard.step(1, 5));
    expect(html).toContain('href="/v2/requests"');
    expect(primaryCount(html!)).toBe(1);
  });

  it("черновик без шага открывает первый незаполненный, с шагом — запрошенный, если он уже пройден", async () => {
    const draft = await makeDraft(h.user!);
    await db.request.update({ where: { id: draft }, data: { wizardStep: 2 } });
    expect((await render(NewRequestPage, { draft })).html).toContain(w.room.title);
    expect((await render(NewRequestPage, { draft, step: "segment" })).html).toContain(w.segment.title);
    expect((await render(NewRequestPage, { draft, step: "send" })).html).toContain(w.room.title);
  });

  it("сводка последнего шага: строки ведут на свои шаги, действие «Отправить мастерам»", async () => {
    const draft = await makeDraft(h.user!);
    const { html } = await render(NewRequestPage, { draft, step: "send" });
    expect(html).toContain(w.send.title);
    expect(html).toContain(w.submit);
    expect(html).toContain(`href="/v2/requests/new?draft=${draft}&amp;step=place"`);
  });

  it("чужой и несуществующий черновик — 404; отправленный — на свою карточку", async () => {
    const foreign = await makeDraft(await makeClient());
    expect(await render(NewRequestPage, { draft: foreign })).toEqual({ notFound: true });
    expect(await render(NewRequestPage, { draft: "no-such" })).toEqual({ notFound: true });
    const sent = await makeOpenRequest(h.user!);
    expect(await render(NewRequestPage, { draft: sent })).toEqual({ redirect: `/v2/requests/${sent}` });
  });

  it("«Хочу похожее» (like=): заявка мастеру работы, «Назад» — в его профиль; чужая или несуществующая работа — 404", async () => {
    const executor = await makeExecutor();
    const item = await makePortfolioItem(executor);
    const label = ru.common.executorLabel(executor.executor.publicNumber);
    const { html } = await render(NewRequestPage, { like: item.id });
    expect(html).toContain(w.directFor(label));
    expect(html).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
    expect(await render(NewRequestPage, { like: "no-such-work" })).toEqual({ notFound: true });
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    const own = await makePortfolioItem(both);
    h.user = { ...both, role: "CLIENT" };
    expect(await render(NewRequestPage, { like: own.id })).toEqual({ notFound: true });
  });

  it("уровень: вилка цены от трёх предложений на тот же тип и уровень (с оговоркой), меньше — «Цену назовут мастера»", async () => {
    const type = await makeFurnitureType();
    const other = await makeClient();
    for (const price of [500_000, 600_000, 700_000]) {
      const requestId = await makeOpenRequest(other, { segment: "COMFORT", typeId: type.id });
      await sendOffer(await makeExecutor({ segment: "COMFORT" }), offerInput(requestId, price));
    }
    const draft = await makeDraft(h.user!, { typeId: type.id });
    const { html } = await render(NewRequestPage, { draft, step: "segment" });
    const text = html!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    expect(text).toContain(w.segment.price(formatMoney(50_000_000n), formatMoney(70_000_000n)).replace(/\s+/g, " "));
    expect(text).toContain(w.segment.priceNote(3).replace(/\s+/g, " "));
    // Эконом и Премиум — предложений нет.
    expect(text.split(w.segment.noPrice).length - 1).toBe(2);

    const lonely = await makeDraft(h.user!);
    const plain = (await render(NewRequestPage, { draft: lonely, step: "segment" })).html!;
    expect(plain.split(w.segment.noPrice).length - 1).toBe(3);
    expect(plain).not.toContain(w.segment.priceNote(3));
  });

  it("на шагах v2 нет слова «исполнитель», кроме подписи мастера прямой заявки", async () => {
    const executor = await makeExecutor();
    const label = ru.common.executorLabel(executor.executor.publicNumber);
    const plainDraft = await makeDraft(h.user!);
    const pages = [{}, ...(["start", "segment", "room", "place", "send"] as const).map((step) => ({ draft: plainDraft, step }))];
    for (const params of [...pages, { executor: String(executor.executor.publicNumber) }]) {
      const { html } = await render(NewRequestPage, params);
      expect(html!.split(label).join("")).not.toMatch(/исполнител/i);
    }
  });

  it("прямая заявка: «Заявка для: Исполнитель №N» без имени; неверный, несуществующий или свой номер — 404", async () => {
    const executor = await makeExecutor({ legalName: "ИП Секретный" });
    const { html } = await render(NewRequestPage, { executor: String(executor.executor.publicNumber) });
    expect(html).toContain(w.directFor(ru.common.executorLabel(executor.executor.publicNumber)));
    expect(html).not.toContain("Секретный");
    // «Назад» с первого шага — в профиль мастера с его подписью.
    expect(html).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);

    for (const executorParam of ["abc", "0", "999999999"]) expect(await render(NewRequestPage, { executor: executorParam })).toEqual({ notFound: true });
    const both = await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] });
    h.user = { ...both, role: "CLIENT" };
    expect(await render(NewRequestPage, { executor: String(both.executor.publicNumber) })).toEqual({ notFound: true });
  });
});
