import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { cancelDeal, processDealMoney, resolveDispute, submitDisputePosition } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeExecutor, makeOperator } from "../../../../../../test/factories";
import { dealAt, journalOf, makePhoto, signAct } from "../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../test/factories/session";
import { openDisputeAction, submitPositionAction } from "./dispute/actions";
import DisputePage from "./dispute/page";
import MoneyPage from "./money/page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

// Спор и история денег глазами мастера (сделка dealAt: цена 100 000 ₸, покупатель платит 102 000 ₸, мастер получает 96 000 ₸).

const td = ru.app.masterDispute;
const tm = ru.app.masterMoney;
const DESCRIPTION = "Покупатель отказывается принимать работу без объяснения причин";
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ|заказчик|выплат|договор/i;
const BUYER_TOTAL = 102_000_00n;
const PROTECTION = 2_000_00n;
const YOU_GET = 96_000_00n;

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

type Fixture = Awaited<ReturnType<typeof dealAt>>;
async function asMaster(f: Fixture) {
  await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
  await signInAs(f.executor);
}

const disputePage = async (id: string) => renderToStaticMarkup(await DisputePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const moneyPage = async (id: string) => renderToStaticMarkup(await MoneyPage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replaceAll("Тестовый заказ", "").replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
const amountsIn = (text: string) => (text.match(/\d[\d ]* ₸/g) ?? []).map((x) => x.trim());
const h1s = (out: string) => [...out.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
const primaries = (out: string) => [...out.matchAll(/data-primary-action/g)].length;
const timelineItems = (out: string) => (out.match(new RegExp(`<ol aria-label="${tm.operationsLabel}"[\\s\\S]*?</ol>`))?.[0].match(/<li/g) ?? []).length;

/** В разметке мастера нет сумм покупателя: «к оплате», защита сделки (2%), остаток и возврат с защитой. */
function expectNoBuyerAmounts(out: string, extra: bigint[] = []) {
  const text = plain(out);
  for (const tiyn of [BUYER_TOTAL, PROTECTION, ...extra]) expect(amountsIn(text), money(tiyn)).not.toContain(money(tiyn));
  expect(text).not.toMatch(/2\s?%|защит[аыеу] сделки|к оплате/i);
  expect(text).not.toMatch(FORBIDDEN);
  // Снимок денег сделки (защита, сумма покупателя) не уходит в атрибуты разметки.
  expect(out).not.toContain(String(BUYER_TOTAL));
}

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

describe("спор мастера: открыть", () => {
  it("форма: слова мастера, последствия «оплата вам приостановлена», одно главное действие, суммы покупателя нет", async () => {
    const f = await dealAt("PAID_HOLD");
    await asMaster(f);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await disputePage(f.dealId);
      expect(h1s(out)).toEqual([td.form.title]);
      for (const reason of Object.values(td.reasons)) expect(out).toContain(reason);
      expect(plain(out)).toContain(td.form.nowNext);
      expect(primaries(out)).toBe(1);
      expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
      expectNoBuyerAmounts(out);
    }
  });

  it("открывает спор мастер, в PAID_HOLD, IN_PROGRESS и READY: оплата приостановлена (FREEZE), статус сделки не меняется", async () => {
    for (const step of ["PAID_HOLD", "IN_PROGRESS", "READY"] as const) {
      const f = await dealAt(step);
      await signInAs(f.executor);
      const result = await openDisputeAction({ dealId: f.dealId, reason: "PAYMENT", description: DESCRIPTION, photoIds: [] });
      expect(result.ok, step).toBe(true);
      expect(await db.dispute.count({ where: { dealId: f.dealId, status: "OPEN" } })).toBe(1);
      expect((await journalOf(f.dealId)).filter((e) => e.type === "FREEZE")).toHaveLength(1);
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe(step);
    }
  });

  it("дважды (двойное нажатие и повтор): один спор и одна остановка оплаты, второй отказ — CONFLICT", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.executor);
    const input = { dealId: f.dealId, reason: "OTHER" as const, description: DESCRIPTION, photoIds: [] };
    const results = await Promise.all([openDisputeAction(input), openDisputeAction(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.code : null).toBe("CONFLICT");
    const again = await openDisputeAction(input);
    expect(again.ok ? null : again.code).toBe("CONFLICT");
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(1);
    expect((await journalOf(f.dealId)).filter((e) => e.type === "FREEZE")).toHaveLength(1);
  });

  it("до оплаты спор открыть нельзя: карточка сделки; чужой мастер — «не найдено»", async () => {
    const early = await dealAt("SIGNED");
    await asMaster(early);
    expect(await outcome(() => disputePage(early.dealId))).toContain(`/v2/deals/${early.dealId}`);
    const f = await dealAt("PAID_HOLD");
    await signInAs((await dealAt("PAID_HOLD")).executor);
    const foreign = await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: DESCRIPTION, photoIds: [] });
    expect(foreign.ok ? null : foreign.code).toBe("NOT_FOUND");
  });
});

describe("спор мастера: действие и фото", () => {
  const input = (dealId: string, photoIds: string[]) => ({ dealId, reason: "OTHER" as const, description: DESCRIPTION, photoIds });

  it("чужое фото или фото не того назначения — ошибка, спора и остановки оплаты нет", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(f.executor);
    const foreign = await makePhoto(f.client, "DISPUTE");
    const wrongPurpose = await makePhoto(f.executor, "PORTFOLIO");
    for (const id of [foreign, wrongPurpose]) {
      const result = await openDisputeAction(input(f.dealId, [id]));
      expect(result.ok).toBe(false);
    }
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(0);
    expect((await journalOf(f.dealId)).filter((e) => e.type === "FREEZE")).toHaveLength(0);
    // Своё фото нужного назначения — принимается.
    expect((await openDisputeAction(input(f.dealId, [await makePhoto(f.executor, "DISPUTE")]))).ok).toBe(true);
  });

  it("человек с двумя ролями: сторона в неактивной роли — действие «не найдено», экран переключает роль", async () => {
    const f = await dealAt("PAID_HOLD", { executor: await makeExecutor({ roles: ["EXECUTOR", "CLIENT"] }) });
    await db.user.update({ where: { id: f.executor.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(f.executor, "CLIENT");
    const result = await openDisputeAction(input(f.dealId, []));
    expect(result.ok ? null : result.code).toBe("NOT_FOUND");
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(0);
    const where = await outcome(() => disputePage(f.dealId));
    expect(where).toContain("/v2/switch-role");
    expect(decodeURIComponent(where)).toContain("to=EXECUTOR");
  });

  it("причина «Расхождение с офертой»: открыл мастер — покупатель видит нейтральный текст; открыл покупатель — его текст", async () => {
    const byMaster = await dealAt("PAID_HOLD");
    await signInAs(byMaster.executor);
    expect((await openDisputeAction({ ...input(byMaster.dealId, []), reason: "SCOPE" })).ok).toBe(true);
    await db.user.update({ where: { id: byMaster.client.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(byMaster.client);
    const seenByBuyer = plain(await disputePage(byMaster.dealId));
    expect(seenByBuyer).toContain(td.reasons.SCOPE);
    expect(seenByBuyer).not.toContain(ru.app.deal.dispute.reasons.SCOPE);

    const byBuyer = await dealAt("PAID_HOLD");
    await db.user.update({ where: { id: byBuyer.client.id }, data: { emailVerifiedAt: new Date() } });
    await signInAs(byBuyer.client);
    expect((await openDisputeAction({ ...input(byBuyer.dealId, []), reason: "SCOPE" })).ok).toBe(true);
    expect(plain(await disputePage(byBuyer.dealId))).toContain(ru.app.deal.dispute.reasons.SCOPE);
    await asMaster(byBuyer);
    expect(plain(await disputePage(byBuyer.dealId))).toContain(ru.app.deal.dispute.reasons.SCOPE);
  });
});

describe("спор мастера: открыт", () => {
  async function opened(photos = 0) {
    const f = await dealAt("IN_PROGRESS");
    await asMaster(f);
    const photoIds = await Promise.all(Array.from({ length: photos }, () => makePhoto(f.executor, "DISPUTE")));
    expect((await openDisputeAction({ dealId: f.dealId, reason: "DEADLINE", description: DESCRIPTION, photoIds })).ok).toBe(true);
    return f;
  }

  it("состояние: оплата вам приостановлена и «Вы получите» из сметы мастера; суммы покупателя нет; форма позиции", async () => {
    const f = await opened();
    const out = await disputePage(f.dealId);
    const text = plain(out);
    expect(h1s(out)).toEqual([td.open.title]);
    expect(text).toContain(td.open.now.title);
    expect(text).toContain(td.open.now.body);
    expect(text).toContain(`${td.open.moneyTitle} ${money(YOU_GET)}`);
    expect(text).toContain(td.reasons.DEADLINE);
    expect(text).toContain(DESCRIPTION);
    expect(out).toContain('name="position"');
    expect(text).toContain(td.open.positionForm.lead);
    expect(primaries(out)).toBe(1);
    expectNoBuyerAmounts(out);
  });

  it("фото спора видны мастеру", async () => {
    const f = await opened(2);
    const out = await disputePage(f.dealId);
    expect(out).toContain(`alt="${td.open.photoAlt(1, 2)}"`);
    expect([...out.matchAll(/<a [^>]*target="_blank"[^>]*><div[^>]*><img/g)]).toHaveLength(2);
  });

  it("позиция мастера: отправлена — формы нет, подписи «Ваша позиция» и «Позиция покупателя»; повтор перезаписывает, после решения отказ", async () => {
    const f = await opened();
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    expect((await submitPositionAction({ disputeId: dispute.id, position: "Работа идёт по оферте, сроки не нарушены" })).ok).toBe(true);
    expect((await submitPositionAction({ disputeId: dispute.id, position: "Работа идёт по оферте, срок ещё не вышел" })).ok).toBe(true);
    expect((await db.dispute.findUniqueOrThrow({ where: { id: dispute.id } })).executorPosition).toBe("Работа идёт по оферте, срок ещё не вышел");
    await submitDisputePosition(f.client, { disputeId: dispute.id, position: "Срок давно прошёл, мастер не отвечает" });
    const out = await disputePage(f.dealId);
    const text = plain(out);
    expect(out).not.toContain('name="position"');
    expect(primaries(out)).toBe(0);
    expect(text).toContain(`${td.open.yourPosition} Работа идёт по оферте, срок ещё не вышел`);
    expect(text).toContain(`${td.open.otherPosition} Срок давно прошёл, мастер не отвечает`);
    await resolveDispute(await makeOperator(), { disputeId: dispute.id, outcome: "CONTINUE", rationale: "Решение принято по материалам спора" });
    const late = await submitPositionAction({ disputeId: dispute.id, position: "Позиция после решения оператора" });
    expect(late.ok ? null : late.code).toBe("CONFLICT");
  });

  it("позиция: короткая — ошибка схемы", async () => {
    const f = await opened();
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    const short = await submitPositionAction({ disputeId: dispute.id, position: "нет" });
    expect(short.ok ? null : short.code).toBe("VALIDATION");
  });
});

async function resolvedDeal(kind: "FULL_REFUND" | "PARTIAL_SPLIT" | "CONTINUE", extra: { masterShareTiyn?: bigint } = {}) {
  const f = await dealAt("READY");
  await asMaster(f);
  expect((await openDisputeAction({ dealId: f.dealId, reason: "QUALITY", description: DESCRIPTION, photoIds: [] })).ok).toBe(true);
  const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
  await resolveDispute(await makeOperator(), { disputeId: dispute.id, outcome: kind, rationale: "Решение принято по материалам спора", ...extra });
  await processDealMoney(f.dealId);
  await asMaster(f);
  return f;
}

describe("спор мастера: решён", () => {
  it("полный возврат: итог словами мастера, ни одной суммы возврата покупателю", async () => {
    const f = await resolvedDeal("FULL_REFUND");
    const out = await disputePage(f.dealId);
    expect(h1s(out)).toEqual([td.resolved.title]);
    expect(plain(out)).toContain(td.resolved.outcome.FULL_REFUND.title);
    expect(plain(out)).toContain("Решение принято по материалам спора");
    expect(plain(out)).not.toContain(td.resolved.shareToYou);
    const refund = (await journalOf(f.dealId)).find((e) => e.type === "REFUND");
    expectNoBuyerAmounts(out, [refund?.amountTiyn ?? BUYER_TOTAL]);
    expect(primaries(out)).toBe(0);
  });

  it("раздел: «Вам по решению» — доля мастера из журнала; сумма возврата покупателю не показана", async () => {
    const f = await resolvedDeal("PARTIAL_SPLIT", { masterShareTiyn: 60_000_00n });
    const out = await disputePage(f.dealId);
    const journal = await journalOf(f.dealId);
    const master = journal.find((e) => e.type === "SPLIT_MASTER");
    const refund = journal.find((e) => e.type === "REFUND");
    expect(plain(out)).toContain(td.resolved.outcome.PARTIAL_SPLIT.title);
    expect(plain(out)).toContain(`${td.resolved.shareToYou} ${money(master?.amountTiyn ?? 0n)}`);
    expectNoBuyerAmounts(out, [refund?.amountTiyn ?? BUYER_TOTAL]);
  });

  it("сделка продолжается: спор решён, открыть новый можно — форма", async () => {
    const f = await resolvedDeal("CONTINUE");
    expect(h1s(await disputePage(f.dealId))).toEqual([td.form.title]);
  });
});

describe("история денег мастера: по записям журнала", () => {
  /** Каждая запись журнала показана или свёрнута — ровно в одной строке; суммы покупателя в разметке нет. */
  async function check(dealId: string, extra: bigint[] = []) {
    const out = await moneyPage(dealId);
    const journal = (await journalOf(dealId)).filter((e) => e.type !== "RELEASE");
    const split = journal.filter((e) => e.type === "SPLIT_MASTER" || e.type === "SPLIT_PLATFORM");
    expect(timelineItems(out)).toBe(journal.length - split.length + (split.length > 0 ? 1 : 0));
    expectNoBuyerAmounts(out, extra);
    // Выписка и акт — как в «Документах» карточки, без «Поделиться».
    expect(plain(out)).toContain(ru.app.deal.money.documentsSection);
    if (journal.length > 0) expect(plain(out)).toContain(ru.app.deal.openDocument.MONEY_STATEMENT);
    expect(plain(out)).not.toContain(ru.app.deal.money.share);
    return { out, text: plain(out), journal };
  }

  it("до оплаты: «Ждём оплату покупателя», журнал пуст, «Вы получите» в блоке денег", async () => {
    const f = await dealAt("SIGNED");
    await asMaster(f);
    const { text } = await check(f.dealId);
    expect(text).toContain(ru.app.masterDeal.card.money.awaiting);
    expect(text).toContain(tm.empty);
    expect(text).toContain(money(YOU_GET));
  });

  it("оплачена: строка «Деньги покупателя в банке под защитой» без суммы; «Вы получите» только в блоке денег", async () => {
    const f = await dealAt("PAID_HOLD");
    await asMaster(f);
    const { out, text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD"]);
    expect(text).toContain(tm.hold.DONE);
    expect(text).toContain(`${ru.app.masterDeal.card.money.youGet} ${money(YOU_GET)}`);
    expect(timelineItems(out)).toBe(1);
  });

  it("спор: оплата приостановлена — строка без суммы, блок «Оплата вам приостановлена спором»", async () => {
    const f = await dealAt("PAID_HOLD");
    await asMaster(f);
    await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: DESCRIPTION, photoIds: [] });
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "FREEZE"]);
    expect(text).toContain(tm.freeze);
    expect(text).toContain(ru.app.masterDeal.card.money.frozen.title);
  });

  it("завершена: одна строка «Вам переведена оплата» с суммой мастера; доход сервиса без суммы", async () => {
    const f = await dealAt("READY");
    await signAct(f.dealId);
    await processDealMoney(f.dealId);
    await asMaster(f);
    const { text, journal } = await check(f.dealId);
    const master = journal.find((e) => e.type === "SPLIT_MASTER");
    const platform = journal.find((e) => e.type === "SPLIT_PLATFORM");
    expect(text).toContain(tm.payout.DONE);
    expect(amountsIn(text)).toContain(money(master?.amountTiyn ?? 0n));
    expect(amountsIn(text)).not.toContain(money(platform?.amountTiyn ?? 0n));
    expect(text).toContain(ru.app.masterDeal.card.money.completed.done);
  });

  it("раздел по спору: «часть оплаты» с суммой мастера, возврат остатка покупателю — строка без суммы", async () => {
    const f = await resolvedDeal("PARTIAL_SPLIT", { masterShareTiyn: 60_000_00n });
    const journal = await journalOf(f.dealId);
    const refund = journal.find((e) => e.type === "REFUND");
    const master = journal.find((e) => e.type === "SPLIT_MASTER");
    const { text } = await check(f.dealId, [refund?.amountTiyn ?? BUYER_TOTAL]);
    expect(text).toContain(tm.refund.DONE_REST);
    expect(text).toContain(tm.payout.DONE_PART);
    expect(amountsIn(text)).toContain(money(master?.amountTiyn ?? 0n));
  });

  it("возврат целиком: «Деньги вернулись покупателю» без суммы", async () => {
    const f = await dealAt("PAID_HOLD");
    await cancelDeal(f.client, { dealId: f.dealId });
    await processDealMoney(f.dealId);
    await asMaster(f);
    const { text, journal } = await check(f.dealId);
    expect(journal.map((e) => e.type)).toEqual(["HOLD", "REFUND"]);
    expect(text).toContain(tm.refund.DONE);
  });

  it("«Назад: <название сделки>», один h1; компьютер — тоже; чужая сделка — 404", async () => {
    const f = await dealAt("PAID_HOLD");
    await asMaster(f);
    for (const device of ["mobile", "desktop"] as const) {
      h.device = device;
      const out = await moneyPage(f.dealId);
      expect([...out.matchAll(/<h1/g)]).toHaveLength(1);
      expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
      expect(out).toContain(`${ru.app.kit.back}: </span>`);
    }
    await asMaster(await dealAt("PAID_HOLD"));
    expect(await outcome(() => moneyPage(f.dealId))).toContain("404");
  });
});
