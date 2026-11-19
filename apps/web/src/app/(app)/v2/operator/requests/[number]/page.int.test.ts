import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import type { CurrentUser } from "@/modules/identity";
import { db } from "@/platform/db";
import { makeClient, makeExecutor, makeOperator } from "../../../../../../../test/factories";
import { dealAt } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { makeOpenRequest } from "../../../../../../../test/factories/requests";
import { signInAs } from "../../../../../../../test/factories/session";
import { identityFake } from "../../../../../../../test/stubs/identity";
import OperatorDealPage from "../../deals/[id]/page";
import StaleRequestsPage from "../page";
import { setRequestFileHiddenAction } from "./actions";
import RequestFilesPage from "./page";

const h = vi.hoisted(() => ({ revalidated: [] as unknown[][] }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => h.revalidated.push(args), refresh: vi.fn() }));
// Форма расписки в карточке сделки (клиентская) берёт роутер при отрисовке; в серверной разметке теста приложения Next нет.
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const t = ru.app.operatorDisputes.requestFiles;
const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

beforeEach(() => {
  freshBrowser();
  h.revalidated.length = 0;
});
afterEach(() => vi.clearAllMocks());

/** Куда ведёт redirect() / notFound() (бросают ошибку с digest); `null` — перехода нет. */
async function digestOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest === undefined) throw e;
    return digest.startsWith("NEXT_REDIRECT") ? (digest.split(";")[2] ?? digest) : digest;
  }
}

const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as ReactElement);
const filesPage = (number: string) => RequestFilesPage({ params: Promise.resolve({ number }) });
const listPage = (params: Record<string, string> = {}) => StaleRequestsPage({ searchParams: Promise.resolve(params) });

let n = 0;
const file = (requestId: string, uploadedById: string, opts: { purpose?: FilePurpose; contentType?: string; sortOrder?: number; hidden?: boolean } = {}) =>
  db.storedFile.create({
    data: {
      storageKey: `test/operator-page-design-${++n}-${Date.now()}`,
      provider: "local",
      purpose: opts.purpose ?? "REQUEST_DESIGN",
      contentType: opts.contentType ?? "application/pdf",
      size: 1,
      sha256: "x",
      uploadedById,
      requestId,
      sortOrder: opts.sortOrder ?? 0,
      ...(opts.hidden ? { hiddenAt: new Date() } : {}),
    },
  });

async function openRequest(client?: CurrentUser) {
  const owner = client ?? (await makeClient());
  const requestId = await makeOpenRequest(owner, { segment: "COMFORT" });
  const { number } = await db.request.findUniqueOrThrow({ where: { id: requestId }, select: { number: true } });
  return { client: owner, requestId, number };
}

/** Оператор с пройденным вторым шагом входа; браузер — его. */
async function operatorSession() {
  const op = await makeOperator();
  await signInAs(op);
  identityFake.enrollTotp(op.id);
  return op;
}

describe("права: «Файлы заявки» — только оператор со вторым шагом", () => {
  it("гость — на вход с возвратом; без второго шага — на экран кода; покупатель — не на экран оператора", async () => {
    const { number } = await openRequest();
    const here = `/v2/operator/requests/${number}`;
    expect(await digestOf(filesPage(String(number)))).toBe(`/v2/login?next=${encodeURIComponent(here)}`);

    await signInAs(await makeOperator(), undefined, { mfaVerifiedAt: null });
    expect(await digestOf(filesPage(String(number)))).toBe(`/v2/operator/mfa?next=${encodeURIComponent(here)}`);

    freshBrowser();
    await signInAs(await makeClient());
    const target = await digestOf(filesPage(String(number)));
    expect(target).not.toBeNull();
    expect(target).not.toContain("/operator/");
  });

  it("действие: покупатель и мастер — FORBIDDEN, файл не скрыт; неверный вход — VALIDATION", async () => {
    const { client, requestId } = await openRequest();
    const pdf = await file(requestId, client.id);
    await signInAs(client);
    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "1" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    freshBrowser();
    await signInAs(await makeExecutor({ segment: "COMFORT" }));
    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "1" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } })).hiddenAt).toBeNull();

    freshBrowser();
    await operatorSession();
    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "yes" } as never)).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(h.revalidated).toEqual([]);
  });
});

describe("страница /v2/operator/requests/[number]", () => {
  it("файлы проекта по порядку: PDF и фото ссылками, скрытый — с пометкой и кнопкой «Вернуть», видимый — «Скрыть»", async () => {
    const { client, requestId, number } = await openRequest();
    await file(requestId, client.id, { sortOrder: 0 });
    await file(requestId, client.id, { contentType: "image/jpeg", sortOrder: 1, hidden: true });
    await file(requestId, client.id, { purpose: "REQUEST_ROOM", contentType: "image/jpeg" });
    await operatorSession();

    const html = await render(filesPage(String(number)));
    expect(html).toContain(t.title(number));
    expect(html).toContain(t.pdf(1));
    expect(html).toContain(t.photo(2));
    expect(html).not.toContain(t.photo(3));
    expect(html).toContain(t.hidden);
    expect(html).toContain(t.shown);
    expect(html).toContain(t.hideLabel(t.pdf(1)));
    expect(html).toContain(t.restoreLabel(t.photo(2)));
    expect(html).toContain('href="/v2/operator/requests"');
  });

  it("проекта нет — понятная строка вместо таблицы", async () => {
    const { number } = await openRequest();
    await operatorSession();
    const html = await render(filesPage(String(number)));
    expect(html).toContain(t.empty.title);
    expect(html).not.toContain(t.hide);
  });

  it("номера нет или он не число — 404", async () => {
    await operatorSession();
    expect(await digestOf(filesPage("2000000000"))).toBe(NOT_FOUND);
    expect(await digestOf(filesPage("abc"))).toBe(NOT_FOUND);
    expect(await digestOf(filesPage("99999999999999"))).toBe(NOT_FOUND);
  });

  it("«Скрыть» и «Вернуть»: файл меняется, страница обновляется; повтор — ok без второй записи аудита", async () => {
    const { client, requestId } = await openRequest();
    const pdf = await file(requestId, client.id);
    await operatorSession();

    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "1" })).toEqual({ ok: true, data: { changed: true } });
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } })).hiddenAt).toBeInstanceOf(Date);
    expect(h.revalidated).toContainEqual(["/(app)/v2/operator/requests/[number]", "page"]);
    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "1" })).toEqual({ ok: true, data: { changed: false } });
    expect(await db.auditEvent.count({ where: { entityId: requestId, action: "request.design_file_hidden" } })).toBe(1);

    expect(await setRequestFileHiddenAction({ fileId: pdf.id, hidden: "0" })).toEqual({ ok: true, data: { changed: true } });
    expect((await db.storedFile.findUniqueOrThrow({ where: { id: pdf.id } })).hiddenAt).toBeNull();
  });
});

describe("как оператор попадает на страницу", () => {
  it("форма «Открыть заявку» на «Заявках без откликов»: номер — переход, не число — ошибка у поля", async () => {
    await operatorSession();
    const plain = await render(listPage());
    expect(plain).toContain(t.open.number);
    expect(plain).toContain('method="get"');
    expect(await digestOf(listPage({ open: "42" }))).toBe("/v2/operator/requests/42");
    expect(await digestOf(listPage({ open: " 42 " }))).toBe("/v2/operator/requests/42");
    const bad = await render(listPage({ open: "abc" }));
    expect(bad).toContain(t.notFound);
  });

  it("карточка сделки — ссылка «Файлы заявки» на номер её заявки", async () => {
    const f = await dealAt("SIGNED");
    const { number } = await db.request.findFirstOrThrow({ where: { deal: { id: f.dealId } }, select: { number: true } });
    await operatorSession();
    const html = await renderToStaticMarkup((await OperatorDealPage({ params: Promise.resolve({ id: f.dealId }) })) as ReactElement);
    expect(html).toContain(t.link);
    expect(html).toContain(`href="/v2/operator/requests/${number}"`);
  });
});
