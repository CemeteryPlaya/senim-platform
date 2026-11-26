import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { setExecutorIdentityMode } from "@/modules/companies";
import { db } from "@/platform/db";
import { makeExecutor, makeOperator } from "../../../../../../test/factories";
import { makeDealWithReport, makeFurnitureType, makePortfolioItem, makeReview, PRICE_TIYN } from "../../../../../../test/factories/companies";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
// Гость: cookie сессии нет (барьер первых шагов не уводит).
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const { default: ExecutorPage } = await import("./page");
const { executorView } = await import("./_parts/executor-view");
const { loadExecutorPageData } = await import("./_parts/load");
const { formatMoney } = await import("@/kit");

const t = ru.app.guest.executor;

const render = async (publicNumber: string) => renderToStaticMarkup(await ExecutorPage({ params: Promise.resolve({ publicNumber }), searchParams: Promise.resolve({}) }));
const count = (out: string, needle: string) => out.split(needle).length - 1;

const SECRETS = {
  legalName: "ТОО «Секретная Мебель»",
  instagram: "secret_master_insta",
  phone: "+77015550199",
  street: "ул. Секретная, 12",
};

async function seed() {
  const executor = await makeExecutor({ legalName: SECRETS.legalName });
  await db.user.update({ where: { id: executor.id }, data: { phone: SECRETS.phone, instagram: SECRETS.instagram } });
  await db.executorProfile.update({
    where: { id: executor.executor.id },
    data: {
      // «О себе» с контактами и наименованием: до показа они должны быть замаскированы.
      about: `Делаю кухни. Пишите в instagram @${SECRETS.instagram} или звоните ${SECRETS.phone}. Работаю как ${SECRETS.legalName}.`,
      district: "Есиль",
      streetAddress: SECRETS.street,
      yearsExperience: 7,
    },
  });
  const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
  const offPlatform = await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, title: "Светлая кухня", priceFrom: 1_200_000 });
  // Сделка без выбора покупателя: закрытый вид, отзыв с инициалом.
  const plain = await makeReview(executor, 5, `Спасибо, ${SECRETS.legalName}! Мой номер ${SECRETS.phone}`);
  // Сделка, где покупатель разрешил фото, стоимость, район и имя в подписи.
  const shown = await makeDealWithReport({ executor });
  await db.request.update({ where: { id: shown.requestId }, data: { district: "Есиль" } });
  await db.review.create({ data: { dealId: shown.dealId, executorId: executor.executor.id, authorId: shown.client.id, rating: 4, text: "Сделали аккуратно" } });
  await db.dealShowcase.create({
    data: { dealId: shown.dealId, photos: true, price: true, address: "DISTRICT", signature: "NAME", signedAs: "Айгерим", textVersion: "test", updatedById: shown.client.id },
  });
  // Работа портфолио, созданная из сделки: в «Работах вне площадки» её нет — сделка показана в «Сделках на площадке».
  const fromDeal = await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, title: "Работа из сделки" });
  await db.portfolioItem.update({ where: { id: fromDeal.id }, data: { dealId: shown.dealId } });
  await db.executorProfile.update({ where: { id: executor.executor.id }, data: { ratingAvg: 4.5, reviewsCount: 2 } });
  return { executor, offPlatform, plainDealId: plain.dealId, shownDealId: shown.dealId };
}

/** Карточка сделки в разметке: от её якоря до конца статьи. */
function dealCard(out: string, dealId: string): string {
  const start = out.indexOf(`id="deal-${dealId}"`);
  expect(start).toBeGreaterThan(-1);
  return out.slice(start, out.indexOf("</article>", start));
}

function expectNoSecrets(out: string, binTail: string) {
  expect(out).not.toContain(SECRETS.legalName);
  expect(out).not.toContain("Секретная");
  expect(out).not.toContain(SECRETS.instagram);
  expect(out).not.toContain(SECRETS.phone);
  expect(out).not.toContain(SECRETS.phone.slice(-7));
  expect(out).not.toContain(SECRETS.street);
  expect(out).not.toContain("Секретная, 12");
  expect(out).not.toContain(binTail);
  expect(out).not.toMatch(/\b\d{12}\b/);
  expect(out).not.toMatch(/instagram/i);
  expect(out).not.toMatch(/\+7\d{10}/);
  for (const attr of out.matchAll(/\s(?:alt|title|aria-label|data-[a-z-]+)="([^"]*)"/g)) {
    expect(attr[1]).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
  }
}

beforeEach(() => {
  h.device = "mobile";
});

describe("/v2/executors/[publicNumber]: что видит гость", () => {
  it("профиль: подпись «Исполнитель №N», сводка, работа, отзыв; «Назад: Мастера» в список мастеров", async () => {
    const { executor } = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(`Исполнитель №${executor.executor.publicNumber}`);
    expect(out).toContain(t.aboutTitle);
    expect(out).toContain("Светлая кухня");
    expect(out).toContain("Спасибо,");
    expect(out).toContain("7 лет");
    expect(out).toContain('href="/v2/executors"');
    expect(out).not.toMatch(/href="\/(catalog|executors|requests)/);
    // Режим «имя скрыто»: заголовок — метка с номером, не наименование.
    expect(out).toMatch(new RegExp(`<h1[^>]*>Исполнитель №${executor.executor.publicNumber}</h1>`));
    // Карточки работ неинтерактивны: ни одной ссылки на заявку, кроме главного действия.
    expect(out).not.toContain("like=");
    expect(count(out, "/v2/requests/new")).toBe(1);
  });

  it.each(["mobile", "desktop"] as const)("%s: HIDDEN — в HTML нет телефона, Instagram, наименования, улицы и ИИН/БИН", async (device) => {
    h.device = device;
    const { executor } = await seed();
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    expectNoSecrets(await render(String(executor.executor.publicNumber)), profile.binIinLast4);
  });

  it("view-модель страницы, сериализованная в JSON, тоже без контактов (это не проверка потока RSC)", async () => {
    const { executor } = await seed();
    const page = await loadExecutorPageData(executor.executor.publicNumber);
    if (!page) throw new Error("страницы нет");
    expect(page.view.nameShown).toBe(false);
    const json = JSON.stringify(executorView(page), (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    expectNoSecrets(json, profile.binIinLast4);
  });

  it("один h1; одно главное действие — «Предложить заказ» с публичным номером мастера", async () => {
    const { executor } = await seed();
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(String(executor.executor.publicNumber));
      expect(count(out, "<h1")).toBe(1);
      expect(count(out, "data-primary-action")).toBe(1);
      expect(out).toContain(t.action);
      expect(out).toContain(`href="/v2/requests/new?executor=${executor.executor.publicNumber}"`);
    }
  });

  it("пояснение «почему скрыто»: подпись на экране, текст — в пропсах, без данных мастера", async () => {
    const { executor } = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(t.explain.hidden.label);
    const page = await loadExecutorPageData(executor.executor.publicNumber);
    if (!page) throw new Error("страницы нет");
    const { explain } = executorView(page);
    expect(explain.title).toBe(t.explain.hidden.title);
    expect(explain.paragraphs).toEqual(t.explain.hidden.paragraphs);
    expect(explain.paragraphs.join(" ")).toContain("общайтесь в чате сервиса");
    expect(JSON.stringify(explain)).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
  });

  it("мастер без работ, сделок и отзывов: действие есть, «Пока без отзывов» один раз; пустые разделы скрыты, у сделок — текст", async () => {
    const executor = await makeExecutor();
    const out = await render(String(executor.executor.publicNumber));
    expect(count(out, ru.app.kit.rating.none)).toBe(1);
    expect(out).toContain(t.stats.successNone);
    expect(out).not.toMatch(/\d%</);
    expect(out).toContain(`>${t.dealsTitle}<`);
    expect(out).toContain(t.dealsEmpty);
    expect(out).not.toContain(`>${t.highlightsTitle}<`);
    expect(out).not.toContain(`>${t.offPlatformTitle}<`);
    expect(out).not.toContain(">Отзывы<");
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toContain(`href="/v2/requests/new?executor=${executor.executor.publicNumber}"`);
  });

  it("режим «имя показано»: наименование в заголовке, телефон, Instagram и ИИН/БИН — по-прежнему нет", async () => {
    const { executor } = await seed();
    await setExecutorIdentityMode(await makeOperator(), "SHOWN");
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(SECRETS.legalName);
    expect(out).not.toContain(SECRETS.phone);
    expect(out).not.toContain(SECRETS.instagram);
    expect(out).not.toContain(profile.binIinLast4);
    expect(out).not.toMatch(/\b\d{12}\b/);
    expect(out).toContain(t.explain.shown.title);
  });
});

describe("/v2/executors/[publicNumber]: шапка и разделы", () => {
  it("шапка: рейтинг, число отзывов, «Сделок», «Успешных N%»", async () => {
    const { executor } = await seed();
    const out = await render(String(executor.executor.publicNumber));
    const start = out.indexOf(`aria-label="${t.factsLabel}"`);
    expect(start).toBeGreaterThan(-1);
    const header = out.slice(start, out.indexOf("</div>", start));
    expect(header).toContain(">4,5<");
    expect(header).toContain(ru.app.guest.catalog.reviews(2));
    // Две сделки с офертой, обе успешные.
    expect(header).toContain(`>${t.stats.deals}<`);
    expect(header).toMatch(/>2<\/dd>/);
    expect(header).toContain(`>${t.stats.success}<`);
    expect(header).toContain(">100%<");
    expect(header).not.toContain(t.stats.successNone);
  });

  it("«Сделки на площадке»: по карточке на сделку, отзыв — внизу своей сделки с подписью; отдельного раздела отзывов нет", async () => {
    const { executor, plainDealId, shownDealId } = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(`>${t.dealsTitle}<`);
    expect(count(out, 'id="deal-')).toBe(2);

    const shown = dealCard(out, shownDealId);
    expect(shown).toContain(t.outcome.success);
    expect(shown).toContain(formatMoney(PRICE_TIYN));
    expect(shown).toContain("Астана, Есиль");
    expect(shown).toContain("<img");
    expect(shown.indexOf("Кухня")).toBeLessThan(shown.indexOf("Сделали аккуратно"));
    expect(shown.indexOf("Сделали аккуратно")).toBeLessThan(shown.indexOf(t.reviewSignature("Айгерим")));
    expect(shown).toContain(t.reviewRating(4));

    // Без выбора покупателя: ни фото, ни стоимости, ни места; отзыв — свой.
    const plain = dealCard(out, plainDealId);
    expect(plain).toContain("Спасибо,");
    expect(plain).not.toContain("Сделали аккуратно");
    expect(plain).not.toContain("<img");
    expect(plain).not.toContain(t.dealPrice);
    expect(plain).not.toContain(t.dealPlace);

    expect(out).not.toContain(">Отзывы<");
    expect(count(out, "Сделали аккуратно")).toBe(1);
  });

  it("«Работы вне площадки»: без работ из сделок; пометку держит заголовок раздела, не карточка", async () => {
    const { executor } = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(`>${t.offPlatformTitle}<`);
    const section = out.slice(out.indexOf(`>${t.offPlatformTitle}<`));
    expect(section).toContain("Светлая кухня");
    expect(section).not.toContain(`>${t.highlightKind.work}<`);
    expect(out).not.toContain("Работа из сделки");
  });

  it("«Лучшие работы»: выбор мастера в его порядке; нет выбора — раздела нет", async () => {
    const { executor, offPlatform, shownDealId } = await seed();
    const before = await render(String(executor.executor.publicNumber));
    expect(before).not.toContain(`>${t.highlightsTitle}<`);

    await db.executorHighlight.createMany({
      data: [
        { executorId: executor.executor.id, position: 0, dealId: shownDealId },
        { executorId: executor.executor.id, position: 1, portfolioItemId: offPlatform.id },
      ],
    });
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(`>${t.highlightsTitle}<`);
    const section = out.slice(out.indexOf(`>${t.highlightsTitle}<`), out.indexOf(`>${t.dealsTitle}<`));
    expect(section).toContain(t.highlightKind.deal);
    expect(section).toContain("Светлая кухня");
    expect(section.indexOf(t.highlightKind.deal)).toBeLessThan(section.indexOf("Светлая кухня"));
  });
});

describe("/v2/executors/[publicNumber]: 404", () => {
  const notFound = { digest: expect.stringContaining("404") };

  it("неизвестный номер", async () => {
    await expect(render("999999")).rejects.toMatchObject(notFound);
  });

  it.each(["abc", "0", "-5", "17abc", "1.5", "99999999999999999999", ""])("неверный номер %j — 404 без обращения к базе", async (raw) => {
    await expect(render(raw)).rejects.toMatchObject(notFound);
  });

  it("мастер не подтверждён оператором — 404", async () => {
    const pending = await makeExecutor({ status: "PENDING" });
    await expect(render(String(pending.executor.publicNumber))).rejects.toMatchObject(notFound);
  });
});
