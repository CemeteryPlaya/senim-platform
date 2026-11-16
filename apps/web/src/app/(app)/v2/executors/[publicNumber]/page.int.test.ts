import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ru } from "@/i18n/ru";
import { setExecutorIdentityMode } from "@/modules/companies";
import { db } from "@/platform/db";
import { makeExecutor, makeOperator } from "../../../../../../test/factories";
import { makeFurnitureType, makePortfolioItem, makeReview } from "../../../../../../test/factories/companies";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
// Гость: cookie сессии нет (барьер первых шагов не уводит).
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);

const { default: ExecutorPage } = await import("./page");
const { executorView } = await import("./_parts/executor-view");
const { getPublicExecutorPage } = await import("@/modules/companies");

const t = ru.app.guest.executor;

const render = async (publicNumber: string) => renderToStaticMarkup(await ExecutorPage({ params: Promise.resolve({ publicNumber }) }));
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
  await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, title: "Светлая кухня", priceFrom: 1_200_000 });
  await makeReview(executor, 5, `Спасибо, ${SECRETS.legalName}! Мой номер ${SECRETS.phone}`);
  return executor;
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
  it("профиль: подпись «Исполнитель №N», сводка, работа, отзыв; «Назад: Мастера» на каталог v2", async () => {
    const executor = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(`Исполнитель №${executor.executor.publicNumber}`);
    expect(out).toContain(t.aboutTitle);
    expect(out).toContain("Светлая кухня");
    expect(out).toContain("Спасибо,");
    expect(out).toContain("7 лет");
    expect(out).toContain('href="/v2/catalog"');
    expect(out).not.toMatch(/href="\/(catalog|executors|requests)/);
    // Режим «имя скрыто»: заголовок — метка с номером, не наименование.
    expect(out).toMatch(new RegExp(`<h1[^>]*>Исполнитель №${executor.executor.publicNumber}</h1>`));
    // Карточки работ неинтерактивны: ни одной ссылки на заявку, кроме главного действия.
    expect(out).not.toContain("like=");
    expect(count(out, "/v2/requests/new")).toBe(1);
  });

  it.each(["mobile", "desktop"] as const)("%s: HIDDEN — в HTML нет телефона, Instagram, наименования, улицы и ИИН/БИН", async (device) => {
    h.device = device;
    const executor = await seed();
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    expectNoSecrets(await render(String(executor.executor.publicNumber)), profile.binIinLast4);
  });

  it("view-модель страницы, сериализованная в JSON, тоже без контактов (это не проверка потока RSC)", async () => {
    const executor = await seed();
    const page = await getPublicExecutorPage(executor.executor.publicNumber);
    if (!page) throw new Error("страницы нет");
    expect(page.view.nameShown).toBe(false);
    const json = JSON.stringify(executorView(page), (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    const profile = await db.executorProfile.findFirstOrThrow({ where: { id: executor.executor.id } });
    expectNoSecrets(json, profile.binIinLast4);
  });

  it("один h1; одно главное действие — «Предложить заказ» с публичным номером мастера", async () => {
    const executor = await seed();
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
    const executor = await seed();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(t.explain.hidden.label);
    const page = await getPublicExecutorPage(executor.executor.publicNumber);
    if (!page) throw new Error("страницы нет");
    const { explain } = executorView(page);
    expect(explain.title).toBe(t.explain.hidden.title);
    expect(explain.paragraphs).toEqual(t.explain.hidden.paragraphs);
    expect(explain.paragraphs.join(" ")).toContain("общайтесь в чате сервиса");
    expect(JSON.stringify(explain)).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
  });

  it("мастер без работ и отзывов: действие есть, «Пока без отзывов» один раз, раздела отзывов нет", async () => {
    const executor = await makeExecutor();
    const out = await render(String(executor.executor.publicNumber));
    expect(out).toContain(t.worksEmpty);
    expect(count(out, ru.app.kit.rating.none)).toBe(1);
    expect(out).not.toContain(`>${t.reviewsTitle}<`);
    expect(count(out, "<h1")).toBe(1);
    expect(count(out, "data-primary-action")).toBe(1);
    expect(out).toContain(`href="/v2/requests/new?executor=${executor.executor.publicNumber}"`);
  });

  it("режим «имя показано»: наименование в заголовке, телефон, Instagram и ИИН/БИН — по-прежнему нет", async () => {
    const executor = await seed();
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
