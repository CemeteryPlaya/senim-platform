import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { getOwnPortfolioItem, PLACE_MAX as MODULE_PLACE_MAX, PORTFOLIO_DESCRIPTION_MAX, PORTFOLIO_MAX_PHOTOS, PORTFOLIO_TITLE_MAX } from "@/modules/companies";
import { db } from "@/platform/db";
import { makeClient, makeExecutor } from "../../../../../../test/factories";
import { makeFurnitureType, makePortfolioItem, makeUploadedFile } from "../../../../../../test/factories/companies";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../test/factories/session";
import { DESCRIPTION_MAX, PHOTOS_MAX, PLACE_MAX, TITLE_MAX } from "./_parts/work-schema";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (original) => ({
  ...(await original<typeof import("next/navigation")>()),
  useRouter: () => ({ push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} }),
}));

const { default: PortfolioPage } = await import("./page");
const { default: NewWorkPage } = await import("./new/page");
const { default: EditWorkPage } = await import("./[id]/page");
const { createWorkAction, updateWorkAction, setWorkPublishedAction, deleteWorkAction } = await import("./actions");

const m = ru.app.masterPortfolio;
const primaries = (out: string) => out.split("data-primary-action").length - 1;

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

const render = async (el: ReactElement | Promise<ReactElement>) => renderToStaticMarkup(await el);
const input = async (over: Record<string, unknown> = {}) => ({
  furnitureTypeId: (await makeFurnitureType()).id,
  style: "loft" as const,
  title: "Кухня с островом",
  description: "МДФ эмаль, фурнитура Blum",
  priceFrom: 850_000,
  published: true,
  place: "Астана",
  fileIds: [] as string[],
  ...over,
});

describe("пределы схемы v2 равны пределам модуля", () => {
  it("название, описание, место, число фото", () => {
    expect([TITLE_MAX, DESCRIPTION_MAX, PLACE_MAX, PHOTOS_MAX]).toEqual([PORTFOLIO_TITLE_MAX, PORTFOLIO_DESCRIPTION_MAX, MODULE_PLACE_MAX, PORTFOLIO_MAX_PHOTOS]);
  });
});

describe("экраны портфолио", () => {
  it("пусто — обучающий экран с одним действием; после работы — карточка со статусом и ссылкой в правку", async () => {
    const executor = await master();
    const empty = await render(PortfolioPage());
    expect(empty).toContain(m.list.empty.title);
    expect(primaries(empty)).toBe(1);
    const item = await makePortfolioItem(executor, { title: "Шкаф-купе", published: false, photo: false });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(PortfolioPage());
      expect(out).toContain("Шкаф-купе");
      expect(out).toContain(m.list.hidden);
      expect(out).toContain(`href="/v2/executor/portfolio/${item.id}"`);
      expect(out).toContain(m.list.back);
      expect(primaries(out)).toBe(1);
      expect((out.match(/<h1/g) ?? []).length).toBe(1);
    }
  });

  it("мастер на проверке открывает портфолио и форму новой работы", async () => {
    await master({ status: "PENDING" });
    expect(await render(PortfolioPage())).toContain(m.list.empty.title);
    expect(await render(NewWorkPage())).toContain(m.form.create);
  });

  it("чужая и несуществующая работа — 404", async () => {
    const other = await makeExecutor();
    const foreign = await makePortfolioItem(other, { photo: false });
    await master();
    await expect(render(EditWorkPage({ params: Promise.resolve({ id: foreign.id }) }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
    await expect(render(EditWorkPage({ params: Promise.resolve({ id: "nope" }) }))).rejects.toMatchObject({ digest: expect.stringContaining("404") });
  });

  it("правка: форма со значениями работы, статус и действия, «Назад» — «Портфолио»", async () => {
    const executor = await master();
    const item = await makePortfolioItem(executor, { title: "Прихожая", photo: false });
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await render(EditWorkPage({ params: Promise.resolve({ id: item.id }) }));
      expect(out).toContain("Прихожая");
      expect(out).toContain(m.list.published);
      expect(out).toContain(m.actions.menu);
      expect(out).toContain(m.form.back);
      expect(primaries(out)).toBe(1);
      expect((out.match(/<h1/g) ?? []).length).toBe(1);
    }
  });
});

describe("действия портфолио", () => {
  it("создание с фото: работа и фото прикреплены, тексты прошли маску; ошибка схемы — у поля", async () => {
    const executor = await master();
    const file = await makeUploadedFile(executor);
    const created = await createWorkAction(await input({ fileIds: [file.id], description: "Звоните +7 701 123 45 67" }));
    expect(created).toMatchObject({ ok: true, data: { masked: true, photosAttached: true } });
    if (!created.ok) return;
    const saved = await getOwnPortfolioItem(executor, created.data.id);
    expect(saved.photos.map((p) => p.id)).toEqual([file.id]);
    expect(saved.description).not.toContain("701");
    // Опубликована после прикрепления фото.
    expect(saved.published).toBe(true);
    const bad = await createWorkAction(await input({ title: "ab" }));
    expect(bad).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { title: [m.form.errors.title(3, 120)] } });
  });

  it("создание: чужой файл не прикрепился — работа есть, ответ говорит об этом, второй работы нет", async () => {
    const executor = await master();
    const stranger = await makeExecutor();
    const foreignFile = await makeUploadedFile(stranger);
    const created = await createWorkAction(await input({ fileIds: [foreignFile.id] }));
    expect(created).toMatchObject({ ok: true, data: { photosAttached: false } });
    expect(await db.portfolioItem.count({ where: { executorId: executor.executor.id } })).toBe(1);
    // Фото не прикрепились — работа скрыта, в каталоге её нет.
    expect((await db.portfolioItem.findFirstOrThrow({ where: { executorId: executor.executor.id } })).published).toBe(false);
  });

  it("создание без фото и со скрытием: выбор мастера сохраняется как есть", async () => {
    const executor = await master();
    await createWorkAction(await input({ title: "Без фото" }));
    await createWorkAction(await input({ title: "Скрытая", published: false, fileIds: [(await makeUploadedFile(executor)).id] }));
    const rows = await db.portfolioItem.findMany({ where: { executorId: executor.executor.id } });
    expect(Object.fromEntries(rows.map((r) => [r.title, r.published]))).toEqual({ "Без фото": true, "Скрытая": false });
  });

  it("место с адресом — ошибка у поля place; неизвестный тип — у поля типа", async () => {
    await master();
    const place = await createWorkAction(await input({ place: "ул. Абая, 10" }));
    expect(place).toMatchObject({ ok: false, fieldErrors: { place: [m.form.errors.place] } });
    const type = await createWorkAction(await input({ furnitureTypeId: "no-such-type" }));
    expect(type).toMatchObject({ ok: false, fieldErrors: { furnitureTypeId: [m.form.errors.unknownType] } });
  });

  it("правка: поля сохраняются, фото — по разнице; повтор безопасен; тексты после маски в ответе", async () => {
    const executor = await master();
    const item = await makePortfolioItem(executor, { photo: false });
    const first = await makeUploadedFile(executor);
    const second = await makeUploadedFile(executor);
    const data = { id: item.id, ...(await input({ furnitureTypeId: item.furnitureTypeId, fileIds: [first.id, second.id], title: "Новое название", description: "Пишите t.me/someone" })) };
    const saved = await updateWorkAction(data);
    expect(saved).toMatchObject({ ok: true, data: { masked: true, title: "Новое название" } });
    expect((await getOwnPortfolioItem(executor, item.id)).photos.map((p) => p.id).sort()).toEqual([first.id, second.id].sort());
    // Повтор — те же значения, то же состояние.
    expect(await updateWorkAction(data)).toMatchObject({ ok: true });
    expect((await getOwnPortfolioItem(executor, item.id)).photos).toHaveLength(2);
    // Убрали одно фото — открепилось.
    await updateWorkAction({ ...data, fileIds: [first.id] });
    expect((await getOwnPortfolioItem(executor, item.id)).photos.map((p) => p.id)).toEqual([first.id]);
  });

  it("чужая работа: правка, публикация и удаление — «не найдена», ничего не меняется", async () => {
    const owner = await makeExecutor();
    const foreign = await makePortfolioItem(owner, { title: "Чужая", photo: false });
    await master();
    const notFound = { ok: false, code: "NOT_FOUND", error: m.form.errors.notFound };
    expect(await updateWorkAction({ id: foreign.id, ...(await input({ furnitureTypeId: foreign.furnitureTypeId })) })).toMatchObject(notFound);
    expect(await setWorkPublishedAction({ id: foreign.id, published: false })).toMatchObject(notFound);
    expect(await deleteWorkAction({ id: foreign.id })).toMatchObject(notFound);
    const after = await db.portfolioItem.findUniqueOrThrow({ where: { id: foreign.id } });
    expect(after).toMatchObject({ title: "Чужая", published: true });
  });

  it("не мастер не может вызвать действия", async () => {
    const client = await makeClient();
    await signInAs(client);
    expect(await createWorkAction(await input())).toMatchObject({ ok: false });
    expect(await deleteWorkAction({ id: "x" })).toMatchObject({ ok: false });
  });

  it("публикация: скрыть и вернуть; повтор с тем же значением ничего не меняет", async () => {
    const executor = await master();
    const item = await makePortfolioItem(executor, { photo: false });
    expect(await setWorkPublishedAction({ id: item.id, published: false })).toMatchObject({ ok: true, data: { published: false } });
    expect(await setWorkPublishedAction({ id: item.id, published: false })).toMatchObject({ ok: true });
    expect((await db.portfolioItem.findUniqueOrThrow({ where: { id: item.id } })).published).toBe(false);
    await setWorkPublishedAction({ id: item.id, published: true });
    expect((await db.portfolioItem.findUniqueOrThrow({ where: { id: item.id } })).published).toBe(true);
  });

  it("удаление: работа исчезает; по работе есть заявка — отказ с понятным текстом; повтор удаления — «не найдена»", async () => {
    const executor = await master();
    const item = await makePortfolioItem(executor, { photo: false });
    expect(await deleteWorkAction({ id: item.id })).toMatchObject({ ok: true });
    expect(await db.portfolioItem.count({ where: { id: item.id } })).toBe(0);
    expect(await deleteWorkAction({ id: item.id })).toMatchObject({ ok: false, code: "NOT_FOUND" });

    const used = await makePortfolioItem(executor, { photo: false });
    const requestId = await makeOpenRequest(await makeClient(), { segment: "COMFORT" });
    await db.request.update({ where: { id: requestId }, data: { portfolioItemId: used.id } });
    expect(await deleteWorkAction({ id: used.id })).toMatchObject({ ok: false, error: m.actions.hasRequests });
    expect(await db.portfolioItem.count({ where: { id: used.id } })).toBe(1);
  });
});

describe("слова на экранах мастера", () => {
  it("нет «заказчик», «платформа», «отклик» и других запретных слов", async () => {
    const executor = await master();
    await makePortfolioItem(executor, { photo: false });
    const out = (await render(PortfolioPage())).replace(/<[^>]*>/g, " ") + (await render(NewWorkPage())).replace(/<[^>]*>/g, " ");
    expect(out).not.toMatch(/заказчик|платформ|отклик|комисси|эскроу|тестов/i);
  });
});
