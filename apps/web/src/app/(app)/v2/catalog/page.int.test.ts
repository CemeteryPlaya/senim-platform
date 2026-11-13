import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeExecutor } from "../../../../../test/factories";
import { makeFurnitureType, makePortfolioItem } from "../../../../../test/factories/companies";
import CatalogPage from "./page";

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await CatalogPage({ searchParams: Promise.resolve(params) }));

afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

const SECRETS = { legalName: "ТОО «Секретная Мебель»", instagram: "secret_master_insta", phone: "+77015550199", binTail: "7712" };

async function seed() {
  const executor = await makeExecutor({ legalName: SECRETS.legalName });
  await db.user.update({ where: { id: executor.id }, data: { phone: SECRETS.phone, instagram: SECRETS.instagram } });
  const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
  await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, title: "Светлая кухня", priceFrom: 1_200_000 });
  return executor;
}

describe("/v2/catalog: что видит гость", () => {
  it("карточка: название, тип, цена в ₸, ссылка на профиль v2; нет ссылок на v1", async () => {
    const executor = await seed();
    const out = await render();
    expect(out).toContain("Светлая кухня");
    expect(out).toContain("Кухня");
    expect(out.replace(/ | |&nbsp;/g, " ")).toMatch(/от\s+(?:<[^>]*>)?1 200 000\s*₸/);
    expect(out).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
    expect(out).not.toMatch(/href="\/(catalog|executors)/);
    expect(out).not.toContain("data-primary-action");
  });

  it("в HTML нет телефона, Instagram, юридического имени и ИИН/БИН (режим HIDDEN), в том числе в alt и title", async () => {
    await seed();
    const profile = await db.executorProfile.findFirstOrThrow();
    for (const out of [await render(), await render({ type: "kitchen" })]) {
      expect(out).not.toContain(SECRETS.legalName);
      expect(out).not.toContain("Секретная");
      expect(out).not.toContain(SECRETS.instagram);
      expect(out).not.toContain(SECRETS.phone);
      expect(out).not.toContain(SECRETS.phone.slice(-7));
      expect(out).not.toContain(profile.binIinLast4);
      expect(out).not.toMatch(/\b\d{12}\b/);
      expect(out).not.toMatch(/instagram/i);
      for (const attr of out.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)) {
        expect(attr[1]).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
      }
    }
  });

  it("сериализованные пропсы (view-модель) тоже без контактов: только публичные поля", async () => {
    await seed();
    const { listCatalog, parseCatalogFilter } = await import("@/modules/companies");
    const { catalogView } = await import("./_parts/catalog-view");
    const view = catalogView(await listCatalog({ page: 1 }), { types: [] }, parseCatalogFilter({}));
    const json = JSON.stringify(view.cards, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of [SECRETS.legalName, SECRETS.instagram, SECRETS.phone]) expect(json).not.toContain(secret);
  });

  it("пустой фильтр: «Сбросить фильтр» ведёт на каталог v2, главное действие одно", async () => {
    await seed();
    const out = await render({ price: "from1500" });
    expect(out).toContain('href="/v2/catalog"');
    expect(out.split("data-primary-action").length - 1).toBe(1);
  });

  it("страница за последней: пустой экран со ссылкой на первую страницу", async () => {
    await seed();
    const out = await render({ page: "9" });
    expect(out).not.toContain("Светлая кухня");
    expect(out).toContain('href="/v2/catalog"');
  });

  it("пустой каталог без фильтра: действие на главную v2", async () => {
    const out = await render();
    expect(out).toContain('href="/v2"');
    expect(out.split("data-primary-action").length - 1).toBe(1);
  });
});
