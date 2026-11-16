import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { computeSplit } from "@/modules/payments";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../../test/factories";
import { dealOf, journalOf, PRICE } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { makeDispute, makeOffer, makeRequest } from "../../../../../../test/factories/operator";
import { signInAs } from "../../../../../../test/factories/session";
import { identityFake } from "../../../../../../test/stubs/identity";
import { resolveDisputeAction, previewSplitAction } from "./actions";
import DisputeCardPage from "./[id]/page";
import DisputesPage from "./page";
import StaleRequestsPage from "../requests/page";

vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
// Форма решения (клиентская) берёт роутер при отрисовке; в серверной разметке теста приложения Next нет.
vi.mock("next/navigation", async (original) => ({ ...(await original<typeof import("next/navigation")>()), useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }) }));

const MIN = 60_000;
const t = ru.app.operatorDisputes;

beforeEach(() => freshBrowser());
afterEach(() => vi.clearAllMocks());

/** Куда ведёт redirect() из next/navigation (бросает ошибку с digest); `null` — перехода нет. */
async function redirectTarget(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

/** Оператор с подключённым приложением; `verifiedAgo` — сколько минут назад введён код (null — в этой сессии не вводили). */
async function operatorSession(verifiedAgo: number | null) {
  const op = await makeOperator();
  await signInAs(op, undefined, { mfaVerifiedAt: verifiedAgo === null ? null : new Date(Date.now() - verifiedAgo * MIN) });
  identityFake.enrollTotp(op.id);
  return op;
}

const render = async (page: Promise<unknown>) => renderToStaticMarkup((await page) as ReactElement);
const cardPage = (id: string) => DisputeCardPage({ params: Promise.resolve({ id }) });
const requestsPage = (hours?: string) => StaleRequestsPage({ searchParams: Promise.resolve(hours === undefined ? {} : { hours }) });

describe("права: экраны и действия споров — только оператор", () => {
  it("гость — на вход v2 с возвратом; без второго шага — на экран кода; другая роль — в свой дом", async () => {
    const f = await makeDispute();
    const here = `/v2/operator/disputes/${f.disputeId}`;
    expect(await redirectTarget(DisputesPage())).toBe(`/v2/login?next=${encodeURIComponent("/v2/operator/disputes")}`);
    expect(await redirectTarget(cardPage(f.disputeId))).toBe(`/v2/login?next=${encodeURIComponent(here)}`);
    expect(await redirectTarget(requestsPage())).toBe(`/v2/login?next=${encodeURIComponent("/v2/operator/requests")}`);

    const op = await makeOperator();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    expect(await redirectTarget(cardPage(f.disputeId))).toBe(`/v2/operator/mfa?next=${encodeURIComponent(here)}`);

    freshBrowser();
    await signInAs(await makeClient());
    const target = await redirectTarget(DisputesPage());
    expect(target).not.toBeNull();
    expect(target).not.toContain("/operator/disputes");
  });

  it("действия: не оператор и гость получают отказ, ничего не меняется", async () => {
    const f = await makeDispute();
    const input = { disputeId: f.disputeId, outcome: "CONTINUE", rationale: "Дефект устранён на месте" };
    expect(await resolveDisputeAction(input)).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(await previewSplitAction({ disputeId: f.disputeId, masterShareKzt: "1000" })).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    await signInAs(f.client);
    expect(await resolveDisputeAction(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await previewSplitAction({ disputeId: f.disputeId, masterShareKzt: "1000" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    freshBrowser();
    await signInAs(f.executor);
    expect(await resolveDisputeAction(input)).toMatchObject({ ok: false, code: "FORBIDDEN" });

    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
  });
});

describe("решение спора — со свежим кодом", () => {
  it("код вводили давно или не вводили — MFA_REQUIRED, спор остаётся открытым; расчёт раздела кода не просит", async () => {
    const f = await makeDispute();
    const input = { disputeId: f.disputeId, outcome: "FULL_REFUND", rationale: "Работа не соответствует оферте" };

    await operatorSession(10);
    expect(await resolveDisputeAction(input)).toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    expect(await previewSplitAction({ disputeId: f.disputeId, masterShareKzt: "60000" })).toMatchObject({ ok: true });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });

    freshBrowser();
    await operatorSession(null);
    expect(await resolveDisputeAction(input)).toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
  });

  it("свежий код — решение записано: итог, обоснование, автор; полный возврат — сделка «деньги возвращены»", async () => {
    const f = await makeDispute();
    const op = await operatorSession(1);

    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "FULL_REFUND", rationale: "Работа не соответствует оферте" })).toEqual({ ok: true, data: undefined });

    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({
      status: "RESOLVED",
      outcome: "FULL_REFUND",
      rationale: "Работа не соответствует оферте",
      resolvedById: op.id,
    });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "REFUNDED" });
  });

  it("поля формы: пустое обоснование и раздел без суммы — ошибки у полей, спор не тронут", async () => {
    const f = await makeDispute();
    await operatorSession(1);

    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "CONTINUE", rationale: "  " })).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { rationale: [expect.any(String)] } });
    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "PARTIAL_SPLIT", rationale: "Сделана половина работы" })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { masterShareKzt: [expect.any(String)] },
    });
    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "CONTINUE", rationale: "я".repeat(2001) })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
  });

  it("двойное решение (двойной клик, два окна) — один эффект: одно решение, одна запись аудита, второе — отказ", async () => {
    const f = await makeDispute();
    await operatorSession(1);
    const resolve = () => resolveDisputeAction({ disputeId: f.disputeId, outcome: "CONTINUE", rationale: "Фото не подтверждают дефект" });

    const results = await Promise.all([resolve(), resolve()]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await db.auditEvent.count({ where: { action: "dispute.resolved" } })).toBe(1);
    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "FULL_REFUND", rationale: "Передумали" })).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await dealOf(f.dealId)).toMatchObject({ status: "IN_PROGRESS" });
  });

  it("расчёт раздела равен итогу: суммы из предпросмотра — те же операции журнала после решения", async () => {
    const f = await makeDispute();
    await operatorSession(1);

    const preview = await previewSplitAction({ disputeId: f.disputeId, masterShareKzt: "60 000" });
    if (!preview.ok) throw new Error(preview.error);
    const split = computeSplit(PRICE, 60_000_00n);
    expect(preview.data).toEqual({ shareTiyn: "6000000", masterTiyn: String(split.masterTiyn), platformTiyn: String(split.platformTiyn), refundTiyn: String(split.refundTiyn) });

    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "PARTIAL_SPLIT", masterShareKzt: "60 000", rationale: "Сделана половина работы" })).toMatchObject({ ok: true });

    const journal = await journalOf(f.dealId);
    const amount = (type: string) => String(journal.find((tx) => tx.type === type)?.amountTiyn);
    expect([amount("SPLIT_MASTER"), amount("SPLIT_PLATFORM"), amount("REFUND")]).toEqual([preview.data.masterTiyn, preview.data.platformTiyn, preview.data.refundTiyn]);
    expect(await dealOf(f.dealId)).toMatchObject({ status: "SPLIT_PAYOUT" });
  });

  it("сумма мастеру больше цены — ошибка у поля суммы и в расчёте, и в решении", async () => {
    const f = await makeDispute();
    await operatorSession(1);
    const tooBig = String(Number(PRICE / 100n) + 1);

    expect(await previewSplitAction({ disputeId: f.disputeId, masterShareKzt: tooBig })).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { masterShareKzt: [expect.any(String)] } });
    expect(await resolveDisputeAction({ disputeId: f.disputeId, outcome: "PARTIAL_SPLIT", masterShareKzt: tooBig, rationale: "Сделана половина работы" })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await db.dispute.findUniqueOrThrow({ where: { id: f.disputeId } })).toMatchObject({ status: "OPEN" });
  });
});

describe("экраны", () => {
  it("список: открытый спор — ссылка на карточку, цена по оферте, причина; пусто — обучающий экран", async () => {
    await operatorSession(1);
    expect(await render(DisputesPage())).toContain(t.disputes.empty.title);

    const f = await makeDispute();
    const html = await render(DisputesPage());
    expect(html).toContain(`href="/v2/operator/disputes/${f.disputeId}"`);
    expect(html).toContain(t.disputes.reasons.QUALITY);
    expect(html).toContain(t.disputes.status.OPEN);
    expect(html).toContain(`aria-label="${ru.app.kit.table.region(t.disputes.title)}"`);
  });

  it("карточка открытого спора: позиции сторон, форма решения, деньги заморожены; решённого — итог без формы", async () => {
    const f = await makeDispute();
    await operatorSession(1);

    const open = await render(cardPage(f.disputeId));
    expect(open).toContain("Нужна замена фасадов");
    expect(open).toContain("Царапины появились при монтаже техники");
    expect(open).toContain(t.decision.submit);
    expect(open).toContain(t.money.frozen);
    expect(open).toContain(`href="/v2/operator/deals/${f.dealId}"`);

    await resolveDisputeAction({ disputeId: f.disputeId, outcome: "CONTINUE", rationale: "Царапины от монтажа техники" });
    const done = await render(cardPage(f.disputeId));
    expect(done).not.toContain(t.decision.submit);
    expect(done).toContain(t.resolved.title);
    expect(done).toContain("Царапины от монтажа техники");
    expect(done).toContain(t.disputes.outcomes.CONTINUE);
  });

  it("несуществующий спор — 404", async () => {
    await operatorSession(1);
    await expect(cardPage("no-such-dispute")).rejects.toMatchObject({ digest: expect.stringContaining("NEXT_HTTP_ERROR_FALLBACK;404") });
  });

  it("заявки без откликов: по умолчанию сутки; чип часов в адресе; заявка с активным откликом не попадает", async () => {
    await operatorSession(1);
    const stale = await makeRequest({ publishedHoursAgo: 30 });
    const fresh = await makeRequest({ publishedHoursAgo: 2 });
    const answered = await makeRequest({ publishedHoursAgo: 30 });
    await makeOffer(answered.id);
    const week = await makeRequest({ publishedHoursAgo: 100 });

    const day = await render(requestsPage());
    expect(day).toContain(t.requests.request(stale.number));
    expect(day).toContain(t.requests.request(week.number));
    expect(day).not.toContain(t.requests.request(fresh.number));
    expect(day).not.toContain(t.requests.request(answered.number));
    expect(day).toContain('href="/v2/operator/requests?hours=72"');

    const long = await render(requestsPage("72"));
    expect(long).toContain(t.requests.request(week.number));
    expect(long).not.toContain(t.requests.request(stale.number));

    // Значение не из списка — своим чипом; мусор — как по умолчанию.
    expect(await render(requestsPage("5"))).toContain(t.requests.custom(5));
    expect(await render(requestsPage("abc"))).toContain(t.requests.request(stale.number));
  });

  it("заявки: пусто — обучающий экран; телефон заказчика — ссылкой", async () => {
    await operatorSession(1);
    expect(await render(requestsPage())).toContain(t.requests.empty.title);
    const request = await makeRequest({ publishedHoursAgo: 48 });
    const client = await db.user.findUniqueOrThrow({ where: { id: request.clientId } });
    expect(await render(requestsPage())).toContain(`href="tel:${client.phone}"`);
  });
});
