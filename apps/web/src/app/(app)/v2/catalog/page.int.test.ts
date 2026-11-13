import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { setExecutorIdentityMode } from "@/modules/companies";
import { db } from "@/platform/db";
import { resetEnvCache } from "@/platform/env";
import { makeExecutor, makeOperator } from "../../../../../test/factories";
import { makeFurnitureType, makePortfolioItem } from "../../../../../test/factories/companies";
import CatalogPage from "./page";

const render = async (params: Record<string, string> = {}) => renderToStaticMarkup(await CatalogPage({ searchParams: Promise.resolve(params) }));

// Режим имени меняется только в DEMO_MODE (ADR-006).
beforeEach(() => {
  process.env.DEMO_MODE = "true";
  resetEnvCache();
});
afterEach(() => {
  delete process.env.DEMO_MODE;
  resetEnvCache();
});

const SECRETS = { legalName: "ТОО «Секретная Мебель»", instagram: "secret_master_insta", phone: "+77015550199", street: "ул. Потайная, 7" };

async function seed({ realPhoto = false }: { realPhoto?: boolean } = {}) {
  const executor = await makeExecutor({ legalName: SECRETS.legalName });
  await db.executorProfile.update({ where: { id: executor.executor.id }, data: { city: "Астана", district: "Есильский район", streetAddress: SECRETS.street } });
  await db.user.update({ where: { id: executor.id }, data: { phone: SECRETS.phone, instagram: SECRETS.instagram } });
  const kitchen = await makeFurnitureType({ slug: "kitchen", name: "Кухня" });
  // Фото сида (статичная иллюстрация) в карточку не идёт; настоящее — добавляем ниже.
  const item = await makePortfolioItem(executor, { furnitureTypeId: kitchen.id, title: "Светлая кухня", priceFrom: 1_200_000, photo: false });
  if (realPhoto) {
    await db.portfolioItem.update({
      where: { id: item.id },
      data: {
        photos: {
          create: {
            storageKey: "portfolio/real-photo-1.jpg",
            provider: "local",
            purpose: "PORTFOLIO",
            contentType: "image/jpeg",
            size: 100,
            sha256: "1".repeat(64),
            uploadedById: executor.id,
          },
        },
      },
    });
  }
  return { executor, item };
}

/** Телефон, Instagram, ИИН/БИН, улица и внутренние идентификаторы не должны появиться в HTML ни в каком режиме. */
async function expectNoContacts(out: string, ownerId: string) {
  const profile = await db.executorProfile.findFirstOrThrow();
  expect(out).not.toContain(SECRETS.phone);
  expect(out).not.toContain(SECRETS.phone.slice(-7));
  expect(out).not.toContain(SECRETS.instagram);
  expect(out).not.toMatch(/instagram/i);
  expect(out).not.toContain("Потайная");
  expect(out).not.toContain(SECRETS.street);
  expect(out).not.toContain(profile.binIinLast4);
  expect(out).not.toMatch(/\b\d{12}\b/);
  expect(out).not.toContain(ownerId);
  expect(out).not.toContain(profile.id);
}

describe("/v2/catalog: что видит гость", () => {
  it("карточка: название, тип, цена в ₸, строка мастера, ссылка на профиль v2; нет ссылок на v1", async () => {
    const { executor } = await seed();
    const out = await render();
    expect(out).toContain("Светлая кухня");
    expect(out).toContain("Кухня");
    expect(out.replace(/ | |&nbsp;/g, " ")).toMatch(/от\s+(?:<[^>]*>)?1 200 000\s*₸/);
    expect(out).toContain(`Исполнитель №${executor.executor.publicNumber}`);
    expect(out).toContain(`href="/v2/executors/${executor.executor.publicNumber}"`);
    expect(out).toContain('href="/v2/requests/new"');
    expect(out).not.toMatch(/href="\/(catalog|executors|requests)/);
    expect(out).not.toContain("data-primary-action");
  });

  it("режим HIDDEN: нет юридического имени, телефона, Instagram, БИН/ИИН и улицы (и в alt/title/aria-label)", async () => {
    await setExecutorIdentityMode(await makeOperator(), "HIDDEN");
    const { executor } = await seed({ realPhoto: true });
    for (const out of [await render(), await render({ type: "kitchen" })]) {
      expect(out).not.toContain("Секретная");
      expect(out).not.toContain(SECRETS.legalName);
      await expectNoContacts(out, executor.id);
      for (const attr of out.matchAll(/\s(?:alt|title|aria-label)="([^"]*)"/g)) {
        expect(attr[1]).not.toMatch(/Секретная|secret_master|\+7\d{10}|Потайная/);
      }
    }
  });

  it("режим SHOWN: юридическое имя — только в строке мастера как публичная метка; остальное по-прежнему скрыто", async () => {
    await setExecutorIdentityMode(await makeOperator(), "SHOWN");
    const { executor } = await seed({ realPhoto: true });
    const out = await render();
    expect(out).toContain(SECRETS.legalName);
    // Каждое вхождение — внутри абзаца-строки мастера, а не в атрибуте или другом тексте.
    const withoutByline = out.replace(/<p class="[^"]*">ТОО «Секретная Мебель»[^<]*<\/p>/g, "");
    expect(withoutByline).not.toContain("Секретная");
    await expectNoContacts(out, executor.id);
  });

  it("настоящее фото: alt — название и номер снимка, src — подписанная ссылка без идентификаторов", async () => {
    const { executor, item } = await seed({ realPhoto: true });
    const out = await render();
    const img = out.match(/<img[^>]*>/)?.[0] ?? "";
    expect(img).not.toBe("");
    const alt = img.match(/alt="([^"]*)"/)?.[1] ?? "";
    expect(alt).toContain("Светлая кухня");
    expect(alt).toMatch(/\d/);
    expect(alt).not.toMatch(/Секретная|secret_master|\+7\d{10}/);
    const src = decodeURIComponent((img.match(/src="([^"]*)"/)?.[1] ?? "").replace(/&amp;/g, "&"));
    expect(src).toContain("real-photo-1.jpg");
    expect(src).toMatch(/sig|signature|token|expires/i);
    for (const id of [executor.id, executor.executor.id, item.id]) expect(src).not.toContain(id);
  });

  it("сериализованная view-модель тоже без контактов: только публичные поля", async () => {
    await seed();
    const { listCatalog, parseCatalogFilter } = await import("@/modules/companies");
    const { catalogView } = await import("./_parts/catalog-view");
    const view = catalogView(await listCatalog({ page: 1 }), { types: [] }, parseCatalogFilter({}));
    const json = JSON.stringify(view.cards, (_, v: unknown) => (typeof v === "bigint" ? v.toString() : v));
    for (const secret of [SECRETS.legalName, SECRETS.instagram, SECRETS.phone, SECRETS.street]) expect(json).not.toContain(secret);
  });

  it("пустой фильтр: «Сбросить фильтр» ведёт на каталог v2, главное действие одно, перехода по страницам нет", async () => {
    await seed();
    const out = await render({ price: "from1500" });
    expect(out).toContain('href="/v2/catalog"');
    expect(out.split("data-primary-action").length - 1).toBe(1);
    expect(out).not.toMatch(/Страница \d+ из/);
  });

  it("страница за последней: «Такой страницы нет», ссылка на первую, без «Страница N из M»", async () => {
    await seed();
    const out = await render({ page: "9" });
    expect(out).not.toContain("Светлая кухня");
    expect(out).toContain("Такой страницы нет");
    expect(out).toContain("В каталоге 1 страница");
    expect(out).toContain('href="/v2/catalog"');
    expect(out).not.toMatch(/Страница \d+ из/);
  });

  it("пустой каталог без фильтра: действие на главную v2", async () => {
    const out = await render();
    expect(out).toContain('href="/v2"');
    expect(out.split("data-primary-action").length - 1).toBe(1);
  });
});
