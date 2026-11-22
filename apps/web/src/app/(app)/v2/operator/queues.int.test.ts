import { Code, ConnectError } from "@connectrpc/connect";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FilePurpose } from "@/generated/prisma/enums";
import { ru } from "@/i18n/ru";
import { DataTable, KeyValueList, Notice, PageTitle, QueueCard, StatusChip } from "@/kit";
import { getDealShowcase, payForDeal, setDealShowcase } from "@/modules/deal-core";
import { revokePdConsent, sessionCookieName, submitKycDocuments, type CurrentUser } from "@/modules/identity";
import * as operatorModule from "@/modules/operator";
import { listMoneyQueue } from "@/modules/operator";
import { db } from "@/platform/db";
import { AppError } from "@/platform/errors";
import { makeClient, makeExecutor, makeOperator } from "../../../../../test/factories";
import { dealAt, dealOf, signAct } from "../../../../../test/factories/deal";
import { asBrowser, freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import { resolveRevocationAction } from "./consents/actions";
import { RevocationDecision } from "./consents/_parts/RevocationDecision";
import ConsentsPage from "./consents/page";
import { addExecutorAction, changeSegmentAction, reviewRegistrationAction } from "./executors/actions";
import { ReviewForms, ReviewProvider } from "./executors/[id]/_parts/ReviewForms";
import { SegmentForm } from "./executors/[id]/_parts/SegmentForm";
import ExecutorCardPage from "./executors/[id]/page";
import ExecutorsPage from "./executors/page";
import { reviewKycAction } from "./kyc/actions";
import { KycDecision } from "./kyc/_parts/KycDecision";
import KycPage from "./kyc/page";
import { confirmBankOperationAction, failBankOperationAction, retryBankOperationAction } from "./money/actions";
import { OperationDecision, RetryForm } from "./money/_parts/OperationDecision";
import MoneyPage from "./money/page";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
// Очередь документов приходит из identity; тест подменяет её, чтобы проверить «нет связи».
vi.mock("@/modules/operator", async (original) => {
  const real = await original<typeof import("@/modules/operator")>();
  return { ...real, kycQueue: vi.fn(real.kycQueue) };
});

const q = ru.app.operatorQueues;
const MIN = 60_000;
const PDF = new TextEncoder().encode("%PDF-1.4\n% документ банка\n");
const pdf = () => new Blob([PDF], { type: "application/pdf" });

const sessions = new Map<string, Promise<string>>();
beforeEach(() => {
  freshBrowser();
  sessions.clear();
});
afterEach(() => vi.clearAllMocks());

/** Вызов от лица вошедшего человека: своя сессия identity и свой «браузер» (`mfaVerifiedAt` — второй шаг этой сессии). */
async function as<T>(user: { id: string }, call: () => Promise<T>, opts: { mfaVerifiedAt?: Date | null } = {}): Promise<T> {
  let signedIn = sessions.get(user.id);
  if (signedIn === undefined) {
    signedIn = signInAs(user, undefined, opts);
    sessions.set(user.id, signedIn);
  }
  const token = await signedIn;
  return asBrowser({ [sessionCookieName()]: token }, call);
}

/** Все элементы дерева страницы (без отрисовки компонентов): какие карточки, формы и пометки экран отдал. */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const props = node.props as { children?: ReactNode; meta?: ReactNode; trailing?: ReactNode; main?: ReactNode; aside?: ReactNode };
  return [node, ...[props.children, props.meta, props.trailing, props.main, props.aside].flatMap(elements)];
}
const ofType = <P,>(tree: ReactNode, type: unknown): P[] => elements(tree).filter((el) => el.type === type).map((el) => el.props as P);

/** Куда ведёт redirect()/notFound() (они бросают ошибку с digest); `null` — перехода нет. */
async function digestOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest;
    if (digest === undefined) throw e;
    return digest;
  }
}

describe("деньги в банке /v2/operator/money", () => {
  /** Оплата ждёт оператора: сделка на manual, оферта подписана, покупатель нажал «Оплатить». */
  async function pendingHold() {
    const f = await dealAt("SIGNED", { provider: "manual" });
    await payForDeal(f.client, { dealId: f.dealId });
    const [op] = await listMoneyQueue(await makeOperator());
    return { ...f, op: op! };
  }
  const confirmInput = (transactionId: string, scan: Blob = pdf()) => ({ transactionId, bankDocNumber: "ПП-17", bankDocDate: "2026-11-16", scan });
  const bankDocs = () => db.storedFile.count({ where: { purpose: "BANK_DOCUMENT" satisfies FilePurpose } });

  it("не оператор — отказ у подтверждения, отказа банка и повтора; скан не сохраняется", async () => {
    const { op } = await pendingHold();
    const client = await makeClient();
    await as(client, async () => {
      expect(await confirmBankOperationAction(confirmInput(op.id))).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await failBankOperationAction({ transactionId: op.id, reason: "Нет поступления" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await retryBankOperationAction({ transactionId: op.id })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    });
    expect(await bankDocs()).toBe(0);
  });

  it("код вводили давно — MFA_REQUIRED до скана и до банка; свежий код — операция подтверждена, сделка оплачена", async () => {
    const { op, dealId } = await pendingHold();
    const operator = await makeOperator();
    const stale = await as(operator, () => confirmBankOperationAction(confirmInput(op.id)), { mfaVerifiedAt: new Date(Date.now() - 10 * MIN) });
    expect(stale).toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    expect(await bankDocs()).toBe(0);
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "PENDING" });

    sessions.clear();
    expect(await as(operator, () => confirmBankOperationAction(confirmInput(op.id)), { mfaVerifiedAt: new Date() })).toEqual({ ok: true, data: undefined });
    expect(await db.moneyTransaction.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ status: "SUCCEEDED", bankDocNumber: "ПП-17" });
    expect(await dealOf(dealId)).toMatchObject({ status: "PAID_HOLD" });
  });

  it("без скана или с пустым файлом — ошибка у поля скана, ничего не сохранено", async () => {
    const { op } = await pendingHold();
    const operator = await makeOperator();
    await as(operator, async () => {
      const noScan = { transactionId: op.id, bankDocNumber: "ПП-17", bankDocDate: "2026-11-16" };
      for (const input of [noScan, confirmInput(op.id, new Blob([]))]) {
        expect(await confirmBankOperationAction(input)).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { scan: [q.money.scanRequired] } });
      }
    });
    expect(await bankDocs()).toBe(0);
  });

  it("двойное подтверждение — ровно один эффект, второму — CONFLICT", async () => {
    const { op, dealId } = await pendingHold();
    const operator = await makeOperator();
    const results = await as(operator, () => Promise.all([confirmBankOperationAction(confirmInput(op.id)), confirmBankOperationAction(confirmInput(op.id))]));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ code: "CONFLICT" });
    expect(await db.auditEvent.count({ where: { action: "payment.operation.confirmed" } })).toBe(1);
    expect(await dealOf(dealId)).toMatchObject({ status: "PAID_HOLD" });
  });

  it("экран: одна очередь с формой у каждой операции, без главной кнопки; отказ банка — карточка уходит из очереди", async () => {
    const { op } = await pendingHold();
    const operator = await makeOperator();
    const page = await as(operator, () => MoneyPage());
    expect(ofType(page, PageTitle)).toHaveLength(1);
    expect(ofType<{ title: string }>(page, QueueCard).map((c) => c.title)).toEqual([q.money.types.HOLD]);
    expect(ofType<{ transactionId: string; type: string }>(page, OperationDecision)).toMatchObject([{ transactionId: op.id, type: "HOLD" }]);

    expect(await as(operator, () => failBankOperationAction({ transactionId: op.id, reason: "Платёж не поступил" }))).toEqual({ ok: true, data: undefined });
    expect(ofType(await as(operator, () => MoneyPage()), OperationDecision)).toHaveLength(0);
  });

  it("раскрытие отклонено банком — карточка с повтором; повтор дважды — одна новая попытка", async () => {
    const f = await dealAt("READY", { provider: "manual" });
    await signAct(f.dealId);
    const operator = await makeOperator();
    const release = (await listMoneyQueue(operator)).find((o) => o.type === "RELEASE")!;
    expect(await as(operator, () => failBankOperationAction({ transactionId: release.id, reason: "Неверные реквизиты" }))).toEqual({ ok: true, data: undefined });

    const failed = await as(operator, () => MoneyPage());
    expect(ofType<{ transactionId: string }>(failed, RetryForm)).toEqual([{ transactionId: release.id }]);

    const retries = await as(operator, () => Promise.all([retryBankOperationAction({ transactionId: release.id }), retryBankOperationAction({ transactionId: release.id })]));
    expect(retries.every((r) => r.ok)).toBe(true);
    expect((await listMoneyQueue(operator)).filter((o) => o.type === "RELEASE")).toHaveLength(1);
    expect(ofType(await as(operator, () => MoneyPage()), RetryForm)).toHaveLength(0);
  });

  it("второй шаг входа не пройден — на экран кода с возвратом в очередь", async () => {
    const operator = await makeOperator();
    expect(await as(operator, () => digestOf(MoneyPage()), { mfaVerifiedAt: null })).toContain(`/v2/operator/mfa?next=${encodeURIComponent("/v2/operator/money")}`);
  });
});

describe("документы мастеров /v2/operator/kyc", () => {
  let n = 0;
  async function upload(user: CurrentUser, purpose: FilePurpose) {
    n += 1;
    const file = await db.storedFile.create({
      data: { storageKey: `kyc/v2/${n}.jpg`, provider: "local", purpose, contentType: "image/jpeg", size: 1000, sha256: "4".repeat(64), uploadedById: user.id },
    });
    return file.id;
  }
  async function submit(executor: CurrentUser) {
    const files = { idFileIds: [await upload(executor, "KYC_ID")], registrationFileIds: [await upload(executor, "KYC_REGISTRATION")] };
    await as(executor, () => submitKycDocuments(executor, files));
  }
  async function decisionsOf(operator: CurrentUser) {
    return ofType<{ userId: string; submittedAt: string }>(await as(operator, () => KycPage()), KycDecision);
  }

  it("мастер прислал новые документы, пока оператор смотрел очередь, — решение по старым не проходит; по свежей очереди — проходит", async () => {
    const executor = await makeExecutor();
    await submit(executor);
    const operator = await makeOperator();
    const [old] = await decisionsOf(operator);
    expect(old?.userId).toBe(executor.id);

    await submit(executor);
    const stale = await as(operator, () => reviewKycAction({ userId: executor.id, submittedAt: old!.submittedAt, decision: "VERIFIED" }));
    expect(stale).toMatchObject({ ok: false, code: "CONFLICT" });

    const [fresh] = await decisionsOf(operator);
    expect(fresh?.submittedAt).not.toBe(old?.submittedAt);
    expect(await as(operator, () => reviewKycAction({ userId: executor.id, submittedAt: fresh!.submittedAt, decision: "VERIFIED" }))).toEqual({ ok: true, data: undefined });
    expect(await decisionsOf(operator)).toEqual([]);
  });

  it("двойное решение — одно; отказ без причины — ошибка у поля; не оператор — FORBIDDEN", async () => {
    const executor = await makeExecutor();
    await submit(executor);
    const operator = await makeOperator();
    const [item] = await decisionsOf(operator);
    const input = { userId: executor.id, submittedAt: item!.submittedAt };

    expect(await as(operator, () => reviewKycAction({ ...input, decision: "REJECTED", reason: "" }))).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { reason: expect.any(Array) } });
    const results = await as(operator, () => Promise.all([reviewKycAction({ ...input, decision: "VERIFIED" }), reviewKycAction({ ...input, decision: "REJECTED", reason: "Фото нечитаемо" })]));
    expect(results.filter((r) => r.ok)).toHaveLength(1);

    const client = await makeClient();
    expect(await as(client, () => reviewKycAction({ ...input, decision: "VERIFIED" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });

  it("identity не отвечает — экран с пояснением вместо очереди, без сбоя", async () => {
    const operator = await makeOperator();
    vi.mocked(operatorModule.kycQueue).mockRejectedValueOnce(new AppError("UNAVAILABLE", "нет связи"));
    const page = await as(operator, () => KycPage());
    expect(ofType<{ children: ReactNode }>(page, Notice).map((p) => p.children)).toContain(q.kyc.unavailable);
    expect(ofType(page, QueueCard)).toHaveLength(0);
  });
});

describe("отзывы согласий /v2/operator/consents", () => {
  it("исполнить — одно решение, повтор — CONFLICT; не оператор — FORBIDDEN", async () => {
    const client = await makeClient();
    await as(client, () => revokePdConsent());
    const operator = await makeOperator();
    const [card] = ofType<{ revocationId: string }>(await as(operator, () => ConsentsPage()), RevocationDecision);
    expect(card?.revocationId).toBeDefined();

    expect(await as(client, () => resolveRevocationAction({ revocationId: card!.revocationId, decision: "COMPLETED" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await as(operator, () => resolveRevocationAction({ revocationId: card!.revocationId, decision: "COMPLETED" }))).toEqual({ ok: true, data: undefined });
    expect(await as(operator, () => resolveRevocationAction({ revocationId: card!.revocationId, decision: "REFUSED", reason: "Идёт сделка" }))).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(ofType(await as(operator, () => ConsentsPage()), RevocationDecision)).toHaveLength(0);
  });

  it("исполненный отзыв закрывает показ сделок покупателя в профиле мастера; отказ — выбор остаётся", async () => {
    const operator = await makeOperator();
    const decide = async (f: Awaited<ReturnType<typeof dealAt>>, decision: "COMPLETED" | "REFUSED") => {
      await db.deal.update({ where: { id: f.dealId }, data: { status: "SPLIT_PAYOUT" } });
      await setDealShowcase(f.client, { dealId: f.dealId, photos: true, price: true, address: "CITY", signature: "NAME" });
      await as(f.client, () => revokePdConsent());
      const card = ofType<{ revocationId: string }>(await as(operator, () => ConsentsPage()), RevocationDecision)[0];
      const reason = decision === "REFUSED" ? { reason: "Идёт сделка" } : {};
      expect(await as(operator, () => resolveRevocationAction({ revocationId: card!.revocationId, decision, ...reason }))).toEqual({ ok: true, data: undefined });
      return getDealShowcase(f.client, f.dealId);
    };
    expect(await decide(await dealAt("SIGNED"), "REFUSED")).toMatchObject({ photos: true, price: true, address: "CITY", signature: "NAME" });
    const completed = await dealAt("SIGNED");
    expect(await decide(completed, "COMPLETED")).toMatchObject({ photos: false, price: false, address: "NONE", signature: "INITIAL" });
    // Закрыто ровно один раз: одна запись системного закрытия.
    expect(await db.auditEvent.count({ where: { entityId: completed.dealId, action: "deal.showcase.changed", actorRole: "SYSTEM" } })).toBe(1);
  });

  it("identity не принял «исполнить» — показ сделок покупателя всё равно закрыт, заявка осталась в очереди", async () => {
    const operator = await makeOperator();
    const f = await dealAt("SIGNED");
    await db.deal.update({ where: { id: f.dealId }, data: { status: "SPLIT_PAYOUT" } });
    await setDealShowcase(f.client, { dealId: f.dealId, photos: true, price: true, address: "CITY", signature: "NAME" });
    await as(f.client, () => revokePdConsent());
    const card = ofType<{ revocationId: string }>(await as(operator, () => ConsentsPage()), RevocationDecision)[0];

    const down = vi.spyOn(identityFake.client, "resolveConsentRevocation").mockRejectedValue(new ConnectError("unavailable", Code.Unavailable));
    expect(await as(operator, () => resolveRevocationAction({ revocationId: card!.revocationId, decision: "COMPLETED" }))).toMatchObject({ ok: false, code: "UNAVAILABLE" });
    down.mockRestore();

    expect(await getDealShowcase(f.client, f.dealId)).toMatchObject({ photos: false, price: false, address: "NONE", signature: "INITIAL" });
    expect(ofType(await as(operator, () => ConsentsPage()), RevocationDecision)).toHaveLength(1);
    // Повтор решения проходит; показ уже закрыт — второго закрытия нет.
    expect(await as(operator, () => resolveRevocationAction({ revocationId: card!.revocationId, decision: "COMPLETED" }))).toEqual({ ok: true, data: undefined });
    expect(await db.auditEvent.count({ where: { entityId: f.dealId, action: "deal.showcase.changed", actorRole: "SYSTEM" } })).toBe(1);
  });

  it("срок ответа истёк — пометка у карточки и число над очередью", async () => {
    const client = await makeClient();
    identityFake.now = () => new Date("2026-01-05T05:00:00Z");
    await as(client, () => revokePdConsent());
    identityFake.now = () => new Date();
    const page = await as(await makeOperator(), () => ConsentsPage());
    expect(ofType<{ children: ReactNode }>(page, StatusChip).map((p) => p.children)).toEqual([q.consents.overdue]);
    expect(ofType<{ children: ReactNode }>(page, Notice).map((p) => p.children)).toContain(q.consents.overdueNotice(1));
  });
});

describe("исполнители /v2/operator/executors", () => {
  it("решение по регистрации — одно: второе (отказ) — CONFLICT; не оператор — FORBIDDEN; карточка после — смена сегмента", async () => {
    const pending = await makeExecutor({ status: "PENDING", legalName: "ИП Ждущий" });
    const operator = await makeOperator();
    const card = () => as(operator, () => ExecutorCardPage({ params: Promise.resolve({ id: pending.executor.id }) }));
    const before = await card();
    expect(ofType<{ profileId: string }>(before, ReviewProvider)).toMatchObject([{ profileId: pending.executor.id }]);
    expect(ofType(before, ReviewForms)).toHaveLength(1);
    // Реквизиты для сверки ввода — отдельный список: название, форма, ИИН/БИН, подписант, счёт для оплаты (маской).
    const r = ru.app.operatorQueues.executors.card.requisites;
    const lists = ofType<{ items: { label: string }[] }>(before, KeyValueList).map((l) => l.items.map((i) => i.label));
    expect(lists).toContainEqual([r.legalName, r.legalForm, r.binIin, r.signer, r.iban]);

    const client = await makeClient();
    expect(await as(client, () => reviewRegistrationAction({ profileId: pending.executor.id, decision: "approve", segment: "PREMIUM" }))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await as(operator, () => reviewRegistrationAction({ profileId: pending.executor.id, decision: "approve", segment: "PREMIUM" }))).toEqual({ ok: true, data: undefined });
    expect(await as(operator, () => reviewRegistrationAction({ profileId: pending.executor.id, decision: "reject", reason: "Нет фото работ" }))).toMatchObject({ ok: false, code: "CONFLICT" });

    const after = await card();
    expect(ofType(after, ReviewForms)).toHaveLength(0);
    expect(ofType(after, ReviewProvider)).toHaveLength(0);
    expect(ofType<{ current: string }>(after, SegmentForm)).toMatchObject([{ current: "PREMIUM" }]);
  });

  it("смена сегмента по устаревшему «было» — CONFLICT, сегмент не меняется", async () => {
    const executor = await makeExecutor({ segment: "COMFORT" });
    const operator = await makeOperator();
    const input = { profileId: executor.executor.id, from: "COMFORT", to: "PREMIUM", reason: "Сильное портфолио" };
    expect(await as(operator, () => changeSegmentAction(input))).toEqual({ ok: true, data: undefined });
    expect(await as(operator, () => changeSegmentAction({ ...input, to: "ECONOMY" }))).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: executor.executor.id } })).toMatchObject({ segment: "PREMIUM" });
  });

  it("добавить вручную — профиль подтверждён; тот же номер ещё раз — CONFLICT; не оператор — FORBIDDEN", async () => {
    const operator = await makeOperator();
    const raw = {
      phone: "+77005553311",
      legalForm: "TOO",
      legalName: "ТОО «Новый цех»",
      binIin: "210140000016",
      directorName: "Тулегенов Бауыржан",
      directorIin: "800215300610",
      segment: "COMFORT",
    };
    expect(await as(await makeClient(), () => addExecutorAction(raw))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const added = await as(operator, () => addExecutorAction(raw));
    expect(added).toMatchObject({ ok: true, data: { profileId: expect.any(String) } });
    const profileId = added.ok ? added.data.profileId : "";
    expect(await db.executorProfile.findUniqueOrThrow({ where: { id: profileId } })).toMatchObject({ status: "APPROVED", addedByOperator: true });
    expect(await as(operator, () => addExecutorAction(raw))).toMatchObject({ ok: false, code: "CONFLICT" });
  });

  it("список: фильтр статуса из адреса — в таблице только такие; неизвестная карточка — 404", async () => {
    await makeExecutor({ status: "PENDING" });
    await makeExecutor({ status: "APPROVED" });
    const operator = await makeOperator();
    const page = await as(operator, () => ExecutorsPage({ searchParams: Promise.resolve({ status: "PENDING" }) }));
    const [table] = ofType<{ rows: { status: string }[] }>(page, DataTable);
    expect(table?.rows.length).toBeGreaterThan(0);
    expect(table?.rows.every((row) => row.status === "PENDING")).toBe(true);

    const missing = await as(operator, () => digestOf(ExecutorCardPage({ params: Promise.resolve({ id: "nope" }) })));
    expect(missing).toContain("404");
  });
});
