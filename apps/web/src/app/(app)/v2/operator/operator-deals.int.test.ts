import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { payForDeal } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../test/factories";
import { dealAt, dealOf, signAct } from "../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import AuditPage from "./audit/page";
import { actionLabel, auditHref, dealIdOf, describeJson, originLine } from "./audit/_parts/audit-view";
import { createReleaseReceiptAction } from "./deals/[id]/actions";
import OperatorDealPage from "./deals/[id]/page";
import OperatorDealsPage from "./deals/page";
import { GET as incomeCsv } from "./income/csv/route";
import IncomePage from "./income/page";
import { GET as reportCsv } from "./report/csv/route";
import ReportPage from "./report/page";
import DealCardPage from "../deals/[id]/(card)/page";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
// Форма расписки (клиентская) берёт роутер при отрисовке; в серверной разметке теста приложения Next нет.
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const t = ru.app.operatorDeals;

beforeEach(() => freshBrowser());
afterEach(() => vi.clearAllMocks());

/** Куда ведёт redirect() / notFound() из next/navigation (бросают ошибку с digest); `null` — перехода нет. */
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

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";
const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as ReactElement);
const sp = (params: Record<string, string> = {}) => ({ searchParams: Promise.resolve(params) });
const dealsPage = () => OperatorDealsPage();
const cardPage = (id: string) => OperatorDealPage({ params: Promise.resolve({ id }) });
const get = (url: string) => new Request(`http://localhost${url}`);

/** Оператор с пройденным вторым шагом входа; браузер — его. */
async function operatorSession() {
  const op = await makeOperator();
  await signInAs(op);
  identityFake.enrollTotp(op.id);
  return op;
}

describe("права: экраны оператора — только оператор со вторым шагом", () => {
  it("гость — на вход v2 с возвратом; без второго шага — на экран кода; другая роль — в свой дом", async () => {
    const f = await dealAt("SIGNED");
    const pages: [string, () => Promise<unknown>][] = [
      ["/v2/operator/deals", dealsPage],
      [`/v2/operator/deals/${f.dealId}`, () => cardPage(f.dealId)],
      ["/v2/operator/income", () => IncomePage(sp())],
      ["/v2/operator/report", () => ReportPage(sp())],
      ["/v2/operator/audit", () => AuditPage(sp())],
    ];
    for (const [here, open] of pages) expect(await digestOf(open()), here).toBe(`/v2/login?next=${encodeURIComponent(here)}`);

    const op = await makeOperator();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    for (const [here, open] of pages) expect(await digestOf(open()), here).toBe(`/v2/operator/mfa?next=${encodeURIComponent(here)}`);

    freshBrowser();
    await signInAs(await makeClient());
    for (const [here, open] of pages) {
      const target = await digestOf(open());
      expect(target, here).not.toBeNull();
      expect(target, here).not.toContain("/operator/");
    }
  });

  it("выгрузки CSV: гость и покупатель получают отказ, файл не отдаётся", async () => {
    const urls = ["/v2/operator/income/csv?from=2026-11-01&to=2026-11-30", "/v2/operator/report/csv?kind=deals&staleDays=3"];
    const calls = [() => incomeCsv(get(urls[0]!)), () => reportCsv(get(urls[1]!))];
    for (const call of calls) {
      const guest = await call();
      expect(guest.status).toBe(401);
      expect(guest.headers.get("Content-Disposition")).toBeNull();
    }
    await signInAs(await makeClient());
    for (const call of calls) {
      const client = await call();
      expect(client.status).toBe(403);
      expect(client.headers.get("Content-Disposition")).toBeNull();
    }
  });

  it("выгрузки CSV: оператор без второго шага получает отказ", async () => {
    await signInAs(await makeOperator(), undefined, { mfaVerifiedAt: null });
    const res = await reportCsv(get("/v2/operator/report/csv?kind=deals"));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers.get("Content-Disposition")).toBeNull();
  });

  it("действие «Сформировать расписку»: не оператор — отказ", async () => {
    const f = await dealAt("SIGNED");
    await signInAs(await makeClient());
    expect(await createReleaseReceiptAction({ dealId: f.dealId })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("оператор на общем экране сделки /v2/deals/[id]", () => {
  it("попадает на свою карточку /v2/operator/deals/[id], а не в v1", async () => {
    const f = await dealAt("SIGNED");
    await operatorSession();
    const target = await digestOf(DealCardPage({ params: Promise.resolve({ id: f.dealId }), searchParams: Promise.resolve({}) }));
    expect(target).toBe(`/v2/operator/deals/${f.dealId}`);
  });
});

describe("сделки /v2/operator/deals", () => {
  it("таблица: сделка ссылкой в карточку, статус, ждущие операции и пометка «тестовая» — только оператору", async () => {
    const manual = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(manual.client, { dealId: manual.dealId });
    const mock = await dealAt("SIGNED");
    await operatorSession();
    const html = await render(dealsPage());
    expect(html).toContain(`/v2/operator/deals/${manual.dealId}`);
    expect(html).toContain(`/v2/operator/deals/${mock.dealId}`);
    expect(html).toContain(t.list.pending(1));
    expect(html).toContain(t.testMark);
    expect(html).toContain(`aria-label="${ru.app.kit.table.region(t.list.title)}"`);
  });

  it("пусто — понятный пустой экран", async () => {
    await operatorSession();
    expect(await render(dealsPage())).toContain(t.list.empty.title);
  });
});

describe("карточка сделки /v2/operator/deals/[id]", () => {
  it("деньги по журналу, ждущая операция со ссылкой в очередь денег, журнал с ключами и пометкой, документы", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    await operatorSession();
    const html = await render(cardPage(f.dealId));
    const deal = await dealOf(f.dealId);
    expect(html).toContain(t.card.title(deal.number));
    expect(html).toContain(t.money.awaiting);
    expect(html).toContain(t.card.pendingTitle);
    expect(html).toContain('href="/v2/operator/money"');
    expect(html).toContain(`${t.moneyTypes.HOLD}, ${t.moneyStatus.PENDING}`);
    expect(html).toContain(`/v2/operator/audit?deal=${deal.number}`);
    // Документ оферты со ссылкой на PDF.
    expect(html).toContain(t.documents.kinds.CONTRACT);
    expect(html).toContain("/api/documents/");
  });

  it("тестовая сделка: пометка в журнале видна оператору", async () => {
    const f = await dealAt("PAID_HOLD");
    await operatorSession();
    const html = await render(cardPage(f.dealId));
    expect(html).toContain(t.testMark);
    expect(html).toContain(t.money.test);
  });

  it("пакет для банка на раскрытие: суммы из журнала, акт и форма расписки; после выпуска — ссылка на PDF", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    await operatorSession();
    const before = await render(cardPage(f.dealId));
    expect(before).toContain(t.release.title);
    expect(before).toContain(t.release.createReceipt);
    expect(before).toContain(t.release.legalReview);

    const made = await createReleaseReceiptAction({ dealId: f.dealId });
    expect(made).toMatchObject({ ok: true });
    // Повтор не создаёт второй документ.
    expect(await createReleaseReceiptAction({ dealId: f.dealId })).toMatchObject({ ok: true });
    expect(await db.document.count({ where: { dealId: f.dealId, kind: "RELEASE_RECEIPT", status: { not: "SUPERSEDED" } } })).toBe(1);
    const after = await render(cardPage(f.dealId));
    expect(after).not.toContain(t.release.createReceipt);
    expect(after).toContain("/pdf");
  });

  it("несуществующая сделка — 404", async () => {
    await operatorSession();
    expect(await digestOf(cardPage("net-takoy"))).toBe(NOT_FOUND);
    expect(await createReleaseReceiptAction({ dealId: "net-takoy" })).toMatchObject({ ok: false, code: "NOT_FOUND" });
  });
});

describe("доход и отчёт", () => {
  it("доход: неверный период — сообщение у поля и отчёт за месяц; верный — форма держит даты; CSV по периоду", async () => {
    await operatorSession();
    expect(await render(IncomePage(sp({ from: "2026-12-01", to: "2026-11-01" })))).toContain(t.income.periodInvalid);
    const ok = await render(IncomePage(sp({ from: "2026-11-01", to: "2026-11-30" })));
    expect(ok).not.toContain(t.income.periodInvalid);
    expect(ok).toContain('value="2026-11-01"');
    expect(ok).toContain("/v2/operator/income/csv?from=2026-11-01&amp;to=2026-11-30");

    const res = await incomeCsv(get("/v2/operator/income/csv?from=2026-11-01&to=2026-11-30"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="senim-income-2026-11-01-2026-11-30.csv"');
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.text()).toContain(ru.operator.csvHeaders.income[0]);
    expect((await incomeCsv(get("/v2/operator/income/csv?from=x&to=y"))).status).toBe(400);
  });

  it("отчёт: сводка, расхождения по числу дней, три выгрузки; CSV каждого вида и отказ на неверный вид", async () => {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    await operatorSession();
    const html = await render(ReportPage(sp({ staleDays: "3" })));
    expect(html).toContain(t.report.dealsByStatus);
    expect(html).toContain(t.report.discrepanciesEmpty.title);
    for (const kind of ["deals", "operations", "discrepancies"] as const) {
      expect(html).toContain(`/v2/operator/report/csv?kind=${kind}&amp;staleDays=3`);
      const res = await reportCsv(get(`/v2/operator/report/csv?kind=${kind}&staleDays=3`));
      expect(res.status).toBe(200);
      // Дата в имени файла — день по Астане, не по UTC.
      const astana = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Almaty" }).format(new Date());
      expect(res.headers.get("Content-Disposition")).toBe(`attachment; filename="senim-${kind}-${astana}.csv"`);
      expect(await res.text()).toContain(ru.operator.csvHeaders[kind][0]);
    }
    expect((await reportCsv(get("/v2/operator/report/csv?kind=nope"))).status).toBe(400);
    // Неверное число дней — сообщение у поля, расчёт на значении по умолчанию.
    expect(await render(ReportPage(sp({ staleDays: "999" })))).toContain(t.report.staleDaysInvalid);
  });
});

describe("журнал аудита /v2/operator/audit", () => {
  it("фильтр по номеру сделки: только её история; неизвестная сделка — пусто; сделка в записи — ссылкой", async () => {
    const a = await dealAt("SIGNED");
    await dealAt("SIGNED");
    const number = (await dealOf(a.dealId)).number;
    await operatorSession();
    const own = await render(AuditPage(sp({ deal: String(number) })));
    expect(own).toContain(`/v2/operator/deals/${a.dealId}`);
    expect(own).toContain(t.audit.openDeal);
    expect(own).toContain(`value="${number}"`);
    expect(own).toContain(t.audit.filtersActive(1));
    expect(await render(AuditPage(sp({ deal: "999999" })))).toContain(t.audit.empty.title);
  });

  it("фильтры действия и автора сужают список; нераспознанные фильтры не применяются и объявлены", async () => {
    const f = await dealAt("SIGNED");
    const op = await operatorSession();
    const all = await render(AuditPage(sp()));
    expect(all).toContain(t.audit.title);
    expect(all).not.toContain(t.audit.invalid);

    const byAction = await render(AuditPage(sp({ action: "deal.created" })));
    expect(byAction).toContain("deal.created");
    expect(byAction).not.toContain("document.signed");

    // Автор — оператор: он ничего не делал, записей нет.
    expect(await render(AuditPage(sp({ actorId: op.id })))).toContain(t.audit.empty.title);
    expect(await render(AuditPage(sp({ entityType: "deal", entityId: f.dealId })))).toContain("deal.created");

    // Номер сделки не число — фильтр не применяется, список не пустеет, над ним предупреждение.
    const bad = await render(AuditPage(sp({ deal: "abc" })));
    expect(bad).toContain(t.audit.invalid);
    expect(bad).not.toContain(t.audit.empty.title);
  });

  it("курсор: «Дальше» ведёт на записи старше последней; «К новым записям» — без курсора, фильтры сохраняются", async () => {
    await dealAt("PAID_HOLD");
    await operatorSession();
    const newest = (await db.auditEvent.findFirstOrThrow({ orderBy: { seq: "desc" } })).seq.toString();
    const page = await render(AuditPage(sp({ before: newest, action: "deal" })));
    expect(page).not.toContain(`>${t.audit.seq(newest)}<`);
    expect(page).toContain(t.audit.newest);
    expect(page).toContain("/v2/operator/audit?action=deal");
    expect(page).not.toContain(`before=${newest}"`);
  });
});

describe("audit-view: чистые помощники", () => {
  it("название события: журнал аудита, затем история сделки, затем сам код", () => {
    expect(actionLabel("executor.approved")).toBe(t.audit.actions["executor.approved"]);
    expect(actionLabel("deal.paid")).toBe(ru.deal.history.action["deal.paid"]);
    expect(actionLabel("something.new")).toBe("something.new");
  });

  it("значение до/после одной строкой", () => {
    expect(describeJson(null)).toBe("");
    expect(describeJson({ status: "APPROVED", n: 2 })).toBe("status: APPROVED, n: 2");
    expect(describeJson({ nested: { a: 1 } })).toBe('nested: {"a":1}');
    expect(describeJson(["a", { b: 1 }])).toBe("a, b: 1");
  });

  it("сделка записи — из scope или из самой сущности", () => {
    expect(dealIdOf({ scope: "deal:abc", entityType: "document", entityId: "x" })).toBe("abc");
    expect(dealIdOf({ scope: null, entityType: "deal", entityId: "d1" })).toBe("d1");
    expect(dealIdOf({ scope: "executor:e1", entityType: "executor", entityId: "e1" })).toBeNull();
    expect(dealIdOf({ scope: "deal:", entityType: "x", entityId: "y" })).toBeNull();
  });

  it("откуда: у системных без IP строки нет, у остальных — «не записаны»", () => {
    expect(originLine({ ip: null, userAgent: null, actorRole: "SYSTEM" })).toBeNull();
    expect(originLine({ ip: null, userAgent: null, actorRole: "CLIENT" })).toBe(t.audit.noOrigin);
    expect(originLine({ ip: "1.2.3.4", userAgent: "Safari", actorRole: "CLIENT" })).toBe(`${t.audit.origin}: ${t.audit.ip("1.2.3.4")}, ${t.audit.device("Safari")}`);
  });

  it("адрес журнала: только известные непустые поля и курсор", () => {
    expect(auditHref("/v2/operator/audit", {})).toBe("/v2/operator/audit");
    expect(auditHref("/v2/operator/audit", { deal: "7", action: "", junk: "x", before: "9" })).toBe("/v2/operator/audit?deal=7");
    expect(auditHref("/v2/operator/audit", { deal: "7" }, "42")).toBe("/v2/operator/audit?deal=7&before=42");
  });
});
