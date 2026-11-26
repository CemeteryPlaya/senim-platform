import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { cancelRequest, declineInvitation, inviteExecutor, sendOffer } from "@/modules/requests";
import { db } from "@/platform/db";
import { makeClient } from "../../../../../../test/factories";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeAccepted, makeDraft, makeExecutorWithTerms, makeOpenRequest, offerInput } from "../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../test/factories/session";
import RequestCardPage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
// Клиентское меню берёт роутер приложения, которого в статическом рендере нет; остальное (notFound, redirect) — настоящее.
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined }) }));

const t = ru.app.requestCard;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function buyer(fullName = "Сапаров Ерлан Ержанович") {
  const client = await makeClient(fullName);
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

const render = async (id: string, query: Record<string, string> = {}) =>
  renderToStaticMarkup(await RequestCardPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve(query) }));

/** Исход вызова страницы: адрес перехода или код ошибки Next (404). */
async function outcome(id: string): Promise<string> {
  try {
    await render(id);
    return "page";
  } catch (e) {
    const digest = typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "";
    return digest || "error";
  }
}

const primaries = (out: string) => [...out.matchAll(/<a [^>]*data-primary-action[^>]*href="([^"]*)"/g)].map((m) => m[1]);
const order = (out: string) => [...out.matchAll(/Исполнитель №(\d+)/g)].map((m) => Number(m[1]));
const count = (out: string, needle: string) => out.split(needle).length - 1;

/** Три мастера с разными ценой, сроком и рейтингом: порядок при каждой сортировке свой. */
async function threeOffers(client: Awaited<ReturnType<typeof buyer>>) {
  const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
  const spec = [
    { price: 500_000, days: 10, rating: 3.0 },
    { price: 300_000, days: 40, rating: 4.0 },
    { price: 400_000, days: 20, rating: 5.0 },
  ];
  const executors = [];
  for (const s of spec) {
    const executor = await makeExecutorWithTerms("COMFORT");
    await db.executorProfile.update({ where: { id: executor.executor.id }, data: { ratingAvg: s.rating, reviewsCount: 5 } });
    await sendOffer(executor, offerInput(requestId, s.price, { durationDays: s.days }));
    executors.push(executor.executor.publicNumber);
  }
  return { requestId, numbers: executors };
}

describe("/v2/requests/[id]: заявка с предложениями", () => {
  it("«Пришло 3 предложения», мастера без имён, сортировка по умолчанию — дешевле; главного действия нет", async () => {
    const client = await buyer();
    const { requestId, numbers } = await threeOffers(client);
    await signInAs(client);
    const out = await render(requestId);
    expect(out).toContain("Пришло 3 предложения");
    expect(out).toContain(t.now.offers.next);
    // Цены 300 000, 400 000, 500 000: мастера 2, 3, 1.
    expect(order(out)).toEqual([numbers[1], numbers[2], numbers[0]]);
    expect(out).toMatch(/aria-pressed="true"[^>]*>Дешевле/);
    expect(primaries(out)).toEqual([]);
    expect(count(out, "<h1")).toBe(1);
    expect(out).toContain(`href="/v2/requests/${requestId}/offers/`);
    // Адрес из фабрики («ул. Тестовая») — данные, не текст экрана.
    expect(out.replace("ул. Тестовая, 1, кв. 2", "")).not.toMatch(/платформ|демо|комисси|эскроу|тестов|отклик/i);
  });

  it.each([
    ["duration", [0, 2, 1], "Быстрее"],
    ["rating", [2, 1, 0], "По рейтингу"],
    ["price", [1, 2, 0], "Дешевле"],
    ["unknown", [1, 2, 0], "Дешевле"],
  ] as const)("?sort=%s: порядок мастеров и выбранный сегмент", async (sort, indexes, label) => {
    const client = await buyer();
    const { requestId, numbers } = await threeOffers(client);
    await signInAs(client);
    h.device = "desktop";
    const out = await render(requestId, { sort });
    expect(order(out)).toEqual(indexes.map((i) => numbers[i]));
    expect(out).toMatch(new RegExp(`aria-pressed="true"[^>]*>${label}`));
  });

  it("сводка и меню отмены на обоих устройствах", async () => {
    const client = await buyer();
    const { requestId } = await threeOffers(client);
    await signInAs(client);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(requestId);
      expect(out).toContain(t.details.section);
      expect(out).toContain(`aria-label="${t.actions.menu}"`);
    }
  });

  it("?sent=1 — разовая плашка «Заявка отправлена мастерам»; без параметра её нет", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client);
    await signInAs(client);
    expect(await render(requestId, { sent: "1" })).toContain(t.sent.title);
    expect(await render(requestId)).not.toContain(t.sent.title);
  });
});

describe("/v2/requests/[id]: отклонённые предложения не считаются", () => {
  /** Заявка с двумя предложениями; первое переведено в «отклонено». */
  async function withDeclined(keepLive: boolean) {
    const client = await buyer();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    const first = await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(requestId, 300_000));
    if (keepLive) await sendOffer(await makeExecutorWithTerms("COMFORT"), offerInput(requestId, 400_000));
    await db.offer.update({ where: { id: first.offerId }, data: { status: "DECLINED" } });
    await signInAs(client);
    return requestId;
  }

  it("одно отклонённое и одно действующее — «Пришло 1 предложение», в списке одна строка, сортировки нет", async () => {
    const out = await render(await withDeclined(true));
    expect(out).toContain("Пришло 1 предложение");
    expect(out).toContain(t.offers.section(1));
    expect(out).not.toContain(t.offers.status.declined);
    expect(out).not.toContain("aria-pressed");
  });

  it("только отклонённое — «Ждём предложений», без раздела предложений", async () => {
    const out = await render(await withDeclined(false));
    expect(out).toContain(t.now.waiting.title);
    expect(out).not.toContain(t.offers.section(0));
    expect(out).not.toContain("Пришло");
  });

  it("?sent=1 при уже пришедших предложениях плашку не показывает", async () => {
    const out = await render(await withDeclined(true), { sent: "1" });
    expect(out).not.toContain(t.sent.title);
  });
});

describe("/v2/requests/[id]: без предложений", () => {
  it("«Ждём предложений» со сроком и уведомлением в «Сейчас / Дальше», без карточки-заглушки и без кнопки", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client);
    await signInAs(client);
    const out = await render(requestId);
    expect(out).toContain(t.now.waiting.title);
    expect(out).toContain(t.now.waiting.next);
    expect(out).not.toContain(t.offers.section(0));
    expect(primaries(out)).toEqual([]);
    expect(out).not.toContain("aria-pressed");
  });
});

describe("/v2/requests/[id]: сделка и отмена", () => {
  it("по заявке идёт сделка: «Открыть сделку» на сделку, мастер выбран; меню отмены нет", async () => {
    const client = await buyer();
    const { requestId, dealId } = await makeAccepted(client);
    await signInAs(client);
    const out = await render(requestId);
    expect(out).toContain(t.now.deal.title);
    expect(primaries(out)).toEqual([`/v2/deals/${dealId}`]);
    expect(out).toContain(t.offers.status.accepted);
    expect(out).not.toContain(`aria-label="${t.actions.menu}"`);
  });

  it("отменена: «Заявка отменена», действия нет, меню нет", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client);
    await cancelRequest(client, { requestId });
    await signInAs(client);
    const out = await render(requestId);
    expect(out).toContain(t.now.cancelled.title);
    expect(primaries(out)).toEqual([]);
    expect(out).not.toContain(`aria-label="${t.actions.menu}"`);
    expect(out).not.toContain(t.offers.section(0));
  });
});

describe("/v2/requests/[id]: доступ", () => {
  it("чужая и несуществующая заявка — 404", async () => {
    const owner = await buyer();
    const requestId = await makeOpenRequest(owner);
    const stranger = await buyer("Нурланов Айдос Ержанович");
    await signInAs(stranger);
    expect(await outcome(requestId)).toContain("404");
    expect(await outcome("net-takoj-zayavki")).toContain("404");
  });

  it("гость уходит на вход с возвратом на эту заявку", async () => {
    const owner = await buyer();
    const requestId = await makeOpenRequest(owner);
    const result = await outcome(requestId);
    expect(result).toContain("NEXT_REDIRECT");
    expect(decodeURIComponent(result)).toContain(`/v2/requests/${requestId}`);
  });

  it("черновик ведёт в мастер заявки с параметром черновика", async () => {
    const client = await buyer();
    const draftId = await makeDraft(client);
    await signInAs(client);
    const result = await outcome(draftId);
    expect(result).toContain("NEXT_REDIRECT");
    expect(result).toContain(`/v2/requests/new?draft=${draftId}`);
  });
});

describe("/v2/requests/[id]: приглашённые мастера", () => {
  it("раздел только при приглашениях: мастер ссылкой, статусы «Ждём ответа», «Отказался: причина», «Прислал предложение»", async () => {
    const client = await buyer();
    const requestId = await makeOpenRequest(client, { segment: "COMFORT" });
    await signInAs(client);
    expect(await render(requestId)).not.toContain(t.invitations.section);

    const waiting = await makeExecutorWithTerms("COMFORT");
    const declined = await makeExecutorWithTerms("COMFORT");
    const offered = await makeExecutorWithTerms("COMFORT");
    for (const m of [waiting, declined, offered]) await inviteExecutor(client, { requestId, publicNumber: m.executor.publicNumber });
    await declineInvitation(declined, { requestId, reason: "Занят до весны" });
    await sendOffer(offered, offerInput(requestId));

    const out = await render(requestId);
    expect(out).toContain(`>${t.invitations.section}<`);
    const section = out.slice(out.indexOf(`>${t.invitations.section}<`));
    for (const m of [waiting, declined, offered]) expect(section).toContain(`href="/v2/executors/${m.executor.publicNumber}"`);
    expect(section).toContain(t.invitations.status.INVITED);
    expect(section).toContain(t.invitations.declined("Занят до весны"));
    expect(section).toContain(t.invitations.status.OFFERED);
  });
});
