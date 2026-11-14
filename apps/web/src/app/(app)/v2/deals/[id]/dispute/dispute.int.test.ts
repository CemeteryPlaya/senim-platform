import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { formatMoney } from "@/kit";
import { ru } from "@/i18n/ru";
import { processDealMoney, resolveDispute, submitDisputePosition } from "@/modules/deal-core";
import { db } from "@/platform/db";
import { makeClient, makeOperator } from "../../../../../../../test/factories";
import { dealAt, journalOf, makePhoto } from "../../../../../../../test/factories/deal";
import { freshBrowser } from "../../../../../../../test/factories/identity";
import { signInAs } from "../../../../../../../test/factories/session";
import { openDisputeAction, submitPositionAction } from "./actions";
import DisputePage from "./page";

const h = vi.hoisted(() => ({ device: "mobile" as "mobile" | "desktop" }));
vi.mock("@/platform/device", () => ({ getDevice: async () => h.device }));
vi.mock("next/headers", async () => (await import("../../../../../../../test/factories/identity")).nextHeadersMock);
vi.mock("next/navigation", async (importActual) => ({ ...(await importActual<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => undefined, replace: () => undefined }) }));

const t = ru.app.deal.dispute;
const FORBIDDEN = /комисси|эскроу|тестов|демо|платформ/i;
const DESCRIPTION = "Дверцы шкафа перекошены, зазор виден невооружённым глазом";

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  h.device = "mobile";
});

async function buyer() {
  const client = await makeClient("Сапаров Ерлан Ержанович");
  await db.user.update({ where: { id: client.id }, data: { emailVerifiedAt: new Date() } });
  return client;
}

const page = async (id: string) => renderToStaticMarkup(await DisputePage({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) }));
const plain = (out: string) => out.replaceAll("Тестовый заказ", "").replace(/<[^>]*>/g, " ").replace(/&nbsp;| | /g, " ").replace(/\s+/g, " ");
const money = (tiyn: bigint) => formatMoney(tiyn).replace(/[  ]/g, " ");
const h1s = (out: string) => [...out.matchAll(/<h1[^>]*>([^<]*)<\/h1>/g)].map((m) => m[1]);
const primaries = (out: string) => [...out.matchAll(/data-primary-action/g)].length;

async function outcome(run: () => Promise<string>): Promise<string> {
  try {
    await run();
    return "page";
  } catch (e) {
    return typeof e === "object" && e !== null && "digest" in e ? String((e as { digest: unknown }).digest) : "error";
  }
}

describe("спор: форма (спора нет, модуль разрешает открыть)", () => {
  it("причина, описание, фото, пояснение «Что будет дальше»; одно главное действие", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const out = await page(f.dealId);
    expect(h1s(out)).toEqual([t.form.title]);
    for (const reason of Object.values(t.reasons)) expect(out).toContain(reason);
    expect(out).toContain(t.form.descriptionLabel);
    expect(out).toContain(t.form.addPhoto);
    expect(out).toContain(t.form.explain.label);
    expect(primaries(out)).toBe(1);
    expect(plain(out)).not.toMatch(FORBIDDEN);
    expect(out).toContain(`href="/v2/deals/${f.dealId}"`);
  });

  it("то же на компьютере", async () => {
    h.device = "desktop";
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    expect(h1s(await page(f.dealId))).toEqual([t.form.title]);
  });

  it("до оплаты спор открыть нельзя — карточка сделки", async () => {
    const client = await buyer();
    const f = await dealAt("SIGNED", { client });
    await signInAs(client);
    expect(await outcome(() => page(f.dealId))).toContain(`/v2/deals/${f.dealId}`);
  });

  it("чужая и несуществующая сделка — 404", async () => {
    const f = await dealAt("PAID_HOLD");
    await signInAs(await buyer());
    expect(await outcome(() => page(f.dealId))).toContain("404");
    expect(await outcome(() => page("net-takoj"))).toContain("404");
  });
});

describe("openDisputeAction", () => {
  it("открывает спор и приостанавливает выплату: в журнале FREEZE, сделка остаётся в статусе", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const result = await openDisputeAction({ dealId: f.dealId, reason: "QUALITY", description: DESCRIPTION, photoIds: [] });
    expect(result.ok).toBe(true);
    expect(await db.dispute.count({ where: { dealId: f.dealId, status: "OPEN" } })).toBe(1);
    const journal = await journalOf(f.dealId);
    expect(journal.filter((e) => e.type === "FREEZE")).toHaveLength(1);
    expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealId } })).status).toBe("PAID_HOLD");
  });

  it("двойное нажатие: один спор и одна заморозка", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const input = { dealId: f.dealId, reason: "OTHER" as const, description: DESCRIPTION, photoIds: [] };
    const results = await Promise.all([openDisputeAction(input), openDisputeAction(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const failed = results.find((r) => !r.ok);
    expect(failed && !failed.ok ? failed.code : null).toBe("CONFLICT");
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(1);
    expect((await journalOf(f.dealId)).filter((e) => e.type === "FREEZE")).toHaveLength(1);
  });

  it("плохой вход: короткое описание и причина вне списка — по-русски, спора нет", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const short = await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: "мало", photoIds: [] });
    expect(short.ok ? null : short.fieldErrors?.description?.[0]).toBe(ru.deal.validation.disputeDescription);
    const bad = await openDisputeAction({ dealId: f.dealId, reason: "ЧТО-ТО" as "OTHER", description: DESCRIPTION, photoIds: [] });
    expect(bad.ok ? null : bad.fieldErrors?.reason?.[0]).toBe(t.form.errors.reason);
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(0);
  });

  it("чужая сделка — «не найдено»; мастер этим действием спор не открывает", async () => {
    const f = await dealAt("PAID_HOLD");
    const input = { dealId: f.dealId, reason: "OTHER" as const, description: DESCRIPTION, photoIds: [] };
    await signInAs(await makeClient("Нурланов Айдос Ержанович"));
    const other = await openDisputeAction(input);
    expect(other.ok ? null : other.code).toBe("NOT_FOUND");
    await signInAs(f.executor);
    expect((await openDisputeAction(input)).ok).toBe(false);
    expect(await db.dispute.count({ where: { dealId: f.dealId } })).toBe(0);
  });
});

describe("спор открыт", () => {
  it("состояние: выплата приостановлена, деньги в банке, причина, описание; форма позиции — пока своей нет", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    await openDisputeAction({ dealId: f.dealId, reason: "DEADLINE", description: DESCRIPTION, photoIds: [] });
    const out = await page(f.dealId);
    expect(h1s(out)).toEqual([t.open.title]);
    expect(plain(out)).toContain(t.open.now.title);
    expect(plain(out)).toContain(t.open.now.body);
    expect(plain(out)).toContain(t.reasons.DEADLINE);
    expect(plain(out)).toContain(DESCRIPTION);
    expect(plain(out)).toContain(money(102_000_00n));
    expect(plain(out)).not.toContain(money(96_000_00n));
    expect(out).toContain('name="position"');
    expect(primaries(out)).toBe(1);
    expect(plain(out)).not.toMatch(FORBIDDEN);
  });

  it("фото к спору показаны превью-ссылками с alt «Фото к спору N из M»", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    const photoIds = [await makePhoto(client, "DISPUTE"), await makePhoto(client, "DISPUTE")];
    expect((await openDisputeAction({ dealId: f.dealId, reason: "QUALITY", description: DESCRIPTION, photoIds })).ok).toBe(true);
    const out = await page(f.dealId);
    expect(out).toContain(`alt="${t.open.photoAlt(1, 2)}"`);
    expect(out).toContain(`alt="${t.open.photoAlt(2, 2)}"`);
    expect([...out.matchAll(/<a [^>]*target="_blank"[^>]*><div[^>]*><img/g)]).toHaveLength(2);
  });

  it("позиция отправлена: формы больше нет, главного действия нет; позиция мастера видна", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: DESCRIPTION, photoIds: [] });
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    const sent = await submitPositionAction({ disputeId: dispute.id, position: "Мебель сделана по оферте, замечаний нет" });
    expect(sent.ok).toBe(true);
    await submitDisputePosition(f.executor, { disputeId: dispute.id, position: "Заказчик не принимает работу без причин" });
    const out = await page(f.dealId);
    expect(out).not.toContain('name="position"');
    expect(primaries(out)).toBe(0);
    expect(plain(out)).toContain("Мебель сделана по оферте");
    expect(plain(out)).toContain("Заказчик не принимает работу без причин");
  });

  it("позиция: короткая — ошибка схемы; чужой спор — «не найдено»", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: DESCRIPTION, photoIds: [] });
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    const short = await submitPositionAction({ disputeId: dispute.id, position: "нет" });
    expect(short.ok ? null : short.code).toBe("VALIDATION");
    await signInAs(await makeClient("Нурланов Айдос Ержанович"));
    const foreign = await submitPositionAction({ disputeId: dispute.id, position: "Это не моя сделка, но напишу позицию" });
    expect(foreign.ok).toBe(false);
  });

  it("спор открыт — повторно открыть нельзя, экран остаётся состоянием спора", async () => {
    const client = await buyer();
    const f = await dealAt("PAID_HOLD", { client });
    await signInAs(client);
    await openDisputeAction({ dealId: f.dealId, reason: "OTHER", description: DESCRIPTION, photoIds: [] });
    expect(h1s(await page(f.dealId))).toEqual([t.open.title]);
  });
});

describe("спор решён", () => {
  async function resolved(outcomeKind: "FULL_REFUND" | "PARTIAL_SPLIT" | "CONTINUE", extra: { masterShareTiyn?: bigint } = {}) {
    const client = await buyer();
    const f = await dealAt("READY", { client });
    await signInAs(client);
    await openDisputeAction({ dealId: f.dealId, reason: "QUALITY", description: DESCRIPTION, photoIds: [] });
    const dispute = await db.dispute.findFirstOrThrow({ where: { dealId: f.dealId } });
    await resolveDispute(await makeOperator(), { disputeId: dispute.id, outcome: outcomeKind, rationale: "Решение принято по материалам спора", ...extra });
    await processDealMoney(f.dealId);
    return f;
  }

  it("полный возврат: итог и сумма возврата из журнала", async () => {
    const f = await resolved("FULL_REFUND");
    const out = await page(f.dealId);
    expect(h1s(out)).toEqual([t.resolved.title]);
    expect(plain(out)).toContain(t.resolved.outcome.FULL_REFUND.title);
    const refund = (await journalOf(f.dealId)).find((e) => e.type === "REFUND");
    expect(refund).toBeDefined();
    expect(plain(out)).toContain(`${t.resolved.refundedToYou} ${money(refund?.amountTiyn ?? 0n)}`);
    expect(plain(out)).toContain("Решение принято по материалам спора");
    expect(primaries(out)).toBe(0);
    expect(plain(out)).not.toMatch(FORBIDDEN);
  });

  it("раздел: мастеру и возврат — суммы из журнала", async () => {
    const f = await resolved("PARTIAL_SPLIT", { masterShareTiyn: 60_000_00n });
    const out = await page(f.dealId);
    expect(plain(out)).toContain(t.resolved.outcome.PARTIAL_SPLIT.title);
    const journal = await journalOf(f.dealId);
    const master = journal.find((e) => e.type === "SPLIT_MASTER");
    const refund = journal.find((e) => e.type === "REFUND");
    expect(plain(out)).not.toContain(money(master?.amountTiyn ?? 0n));
    expect(plain(out)).toContain(`${t.resolved.refundedToYou} ${money(refund?.amountTiyn ?? 0n)}`);
  });

  it("сделка продолжается: спор решён, но открыть новый можно — форма", async () => {
    const f = await resolved("CONTINUE");
    expect(h1s(await page(f.dealId))).toEqual([t.form.title]);
  });
});
