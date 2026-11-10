import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import { ru } from "@/i18n/ru";
import * as operator from "@/modules/operator";
import { totpNow } from "../../../../e2e/totp";
import { requireUserPage } from "@/modules/identity";
import { dealAt } from "../../../../test/factories/deal";
import { freshBrowser } from "../../../../test/factories/identity";
import DealPage, { generateMetadata as dealMetadata } from "../../deals/[id]/page";
import MoneyHistoryPage from "../../deals/[id]/money/page";
import DealsPage from "../../deals/page";
import { signInAs } from "../../../../test/factories/session";
import { makeOperator } from "../../../../test/factories";
import { identityFake } from "../../../../test/stubs/identity";
import { MFA_CODE_FIELD, runWithCode } from "../_components/second-factor";
import { requireOperatorPage } from "../_lib/guard";
import { resolveDisputeAction } from "../disputes/actions";
import { confirmBankOperationAction, failBankOperationAction, retryBankOperationAction } from "../money/actions";
import OperatorHome from "../page";
import { confirmEnrollmentAction, verifySecondFactorAction } from "./actions";
import { MfaForm } from "./MfaForm";
import MfaPage from "./page";

vi.mock("next/headers", async () => (await import("../../../../test/factories/identity")).nextHeadersMock);
// Сервис денег — шпионы: проверяем, что без свежего кода до него дело не доходит.
vi.mock("@/modules/operator", async (original) => {
  const real = await original<typeof import("@/modules/operator")>();
  return {
    ...real,
    saveBankDocument: vi.fn(async () => "file-1"),
    confirmBankOperation: vi.fn(async () => undefined),
    failBankOperation: vi.fn(async () => undefined),
    retryBankOperation: vi.fn(async () => undefined),
    resolveDispute: vi.fn(async () => undefined),
  };
});

const MIN = 60_000;

beforeEach(() => freshBrowser());
afterEach(() => vi.clearAllMocks());

/** Куда ведёт redirect() из next/navigation (он бросает ошибку с digest). */
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

/** Оператор с фактором; mfaVerifiedAt — момент второй ступени этой сессии (null — вошёл только по SMS). */
async function operatorSession(mfaVerifiedAt: Date | null) {
  const op = await makeOperator();
  await signInAs(op, undefined, { mfaVerifiedAt });
  const secret = identityFake.enrollTotp(op.id);
  return { op, secret };
}

const scan = () => new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])], { type: "application/pdf" });
/** Сколько раз вызван сервис денег (сохранение скана, подтверждение, отказ, повтор операции, решение спора). */
const moneyCalls = () =>
  [operator.saveBankDocument, operator.confirmBankOperation, operator.failBankOperation, operator.retryBankOperation, operator.resolveDispute].reduce(
    (n, f) => n + vi.mocked(f).mock.calls.length,
    0,
  );

const actions: [string, () => ReturnType<typeof failBankOperationAction>][] = [
  ["confirmBankOperation", () => confirmBankOperationAction({ transactionId: "tx-1", bankDocNumber: "Б-1", bankDocDate: "2026-11-10", scan: scan() })],
  ["failBankOperation", () => failBankOperationAction({ transactionId: "tx-1", reason: "Банк отклонил платёж" })],
  ["retryBankOperation", () => retryBankOperationAction({ transactionId: "tx-1" })],
  ["resolveDispute", () => resolveDisputeAction({ disputeId: "d-1", outcome: "CONTINUE", rationale: "Работа продолжается по договору" })],
];

describe("страницы оператора: вторая ступень входа", () => {
  it("без mfa.verifiedAt — переход на /operator/mfa с возвратом", async () => {
    await operatorSession(null);
    expect(await redirectTarget(requireOperatorPage("/operator/money"))).toBe("/operator/mfa?next=%2Foperator%2Fmoney");
    expect(await redirectTarget(OperatorHome())).toBe("/operator/mfa?next=%2Foperator");
  });

  it("вторая ступень пройдена (даже давно) — страница открывается", async () => {
    await operatorSession(new Date(Date.now() - 60 * MIN));
    expect(await redirectTarget(requireOperatorPage("/operator/money"))).toBeNull();
  });

  it("гость — на вход с возвратом", async () => {
    expect(await redirectTarget(requireOperatorPage("/operator/money"))).toBe("/login?next=%2Foperator%2Fmoney");
  });
});

describe("страницы вне /operator на getCurrentUser: оператор без второй ступени", () => {
  it("/deals/[id]/money, /deals/[id] и /deals — на /operator/mfa с возвратом, журнал и сделка не читаются; заголовок вкладки без номера", async () => {
    const { dealId } = await dealAt("PAID_HOLD");
    await operatorSession(null);
    expect(await redirectTarget(MoneyHistoryPage({ params: Promise.resolve({ id: dealId }) }))).toBe(`/operator/mfa?next=${encodeURIComponent(`/deals/${dealId}/money`)}`);
    expect(await redirectTarget(DealPage({ params: Promise.resolve({ id: dealId }) }))).toBe(`/operator/mfa?next=${encodeURIComponent(`/deals/${dealId}`)}`);
    expect(await redirectTarget(DealsPage())).toBe("/operator/mfa?next=%2Fdeals");
    expect(await dealMetadata({ params: Promise.resolve({ id: dealId }) })).toEqual({ title: ru.deal.listTitle });
  });

  it("requireUserPage (страницы без роли, например /chats) — тоже на /operator/mfa", async () => {
    await operatorSession(null);
    expect(await redirectTarget(requireUserPage("/chats"))).toBe("/operator/mfa?next=%2Fchats");
  });

  it("вторая ступень пройдена — журнал денег сделки открывается", async () => {
    const { dealId } = await dealAt("PAID_HOLD");
    await operatorSession(new Date(Date.now() - 60 * MIN));
    expect(await redirectTarget(MoneyHistoryPage({ params: Promise.resolve({ id: dealId }) }))).toBeNull();
    expect(await dealMetadata({ params: Promise.resolve({ id: dealId }) })).not.toEqual({ title: ru.deal.listTitle });
  });
});

describe("действия с деньгами: свежий код (≤ MFA_STEP_UP_WINDOW)", () => {
  it.each(actions)("%s: код пройден 6 минут назад — MFA_REQUIRED, сервис денег не вызван", async (_name, run) => {
    await operatorSession(new Date(Date.now() - 6 * MIN));
    const res = await run();
    expect(res).toEqual({ ok: false, code: "MFA_REQUIRED", error: ru.identity.mfa.stepUp });
    expect(moneyCalls()).toBe(0);
  });

  it.each(actions)("%s: вошёл только по SMS — MFA_REQUIRED, сервис денег не вызван", async (_name, run) => {
    await operatorSession(null);
    expect(await run()).toMatchObject({ ok: false, code: "MFA_REQUIRED" });
    expect(moneyCalls()).toBe(0);
  });

  it.each(actions)("%s: код пройден минуту назад — действие выполняется", async (_name, run) => {
    await operatorSession(new Date(Date.now() - MIN));
    expect(await run()).toEqual({ ok: true, data: undefined });
    expect(moneyCalls()).toBeGreaterThan(0);
  });

  it("после MFA_REQUIRED: код из приложения (verifySecondFactorAction) — повтор действия проходит", async () => {
    const { secret } = await operatorSession(new Date(Date.now() - 10 * MIN));
    expect(await retryBankOperationAction({ transactionId: "tx-1" })).toMatchObject({ code: "MFA_REQUIRED" });

    expect(await verifySecondFactorAction({ code: totpNow(secret) })).toEqual({ ok: true, data: undefined });
    expect(await retryBankOperationAction({ transactionId: "tx-1" })).toEqual({ ok: true, data: undefined });
    expect(vi.mocked(operator.retryBankOperation)).toHaveBeenCalledTimes(1);
  });

  it("форма с неверным кодом (runWithCode): ошибка поля кода с числом попыток, действие с деньгами не вызывается", async () => {
    const { secret } = await operatorSession(new Date(Date.now() - 10 * MIN));
    const wrong = totpNow(secret) === "000000" ? "111111" : "000000";
    const retry = vi.fn(retryBankOperationAction);
    const run = await runWithCode({ transactionId: "tx-1", [MFA_CODE_FIELD]: wrong }, (fields) => retry({ transactionId: String(fields["transactionId"]) }), verifySecondFactorAction);
    expect(run).toMatchObject({ step: "code", result: { ok: false, code: "VALIDATION", fieldErrors: { code: [ru.identity.mfa.errors.wrongCode(4)] } } });
    expect(retry).not.toHaveBeenCalled();
    expect(moneyCalls()).toBe(0);

    // Верный код той же формой: сначала код, затем повтор действия — оно доходит до сервиса денег.
    const ok = await runWithCode({ transactionId: "tx-1", [MFA_CODE_FIELD]: totpNow(secret) }, (fields) => retry({ transactionId: String(fields["transactionId"]) }), verifySecondFactorAction);
    expect(ok).toEqual({ step: "action", verified: true, result: { ok: true, data: undefined } });
    expect(vi.mocked(operator.retryBankOperation)).toHaveBeenCalledTimes(1);
  });
});

describe("экран /operator/mfa", () => {
  const page = (next = "/operator/money") => MfaPage({ searchParams: Promise.resolve({ next }) });
  const formOf = async (p: ReturnType<typeof page>) => {
    const el = (await p) as ReactElement<{ children: ReactElement<{ mode: string; next: string; enrollment?: { secret: string } }> }>;
    const form = el.props.children;
    expect(form.type).toBe(MfaForm);
    return form.props;
  };

  it("не подключено — подключение: секрет для ручного ввода; подтверждение ведёт на next", async () => {
    const op = await makeOperator();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    const props = await formOf(page());
    expect(props.mode).toBe("enroll");
    expect(props.next).toBe("/operator/money");
    const secret = props.enrollment?.secret ?? "";
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);

    const target = await redirectTarget(confirmEnrollmentAction({ code: totpNow(secret), next: "/operator/money" }));
    expect(target).toBe("/operator/money");
    expect(identityFake.factorState(op.id)).toBe("confirmed");
  });

  it("подключено — ввод кода; чужой адрес возврата заменяется кабинетом", async () => {
    const { secret } = await operatorSession(null);
    const props = await formOf(page("https://evil.example"));
    expect(props).toMatchObject({ mode: "verify", next: "/operator" });
    expect(await redirectTarget(verifySecondFactorAction({ code: totpNow(secret), next: "//evil.example" }))).toBe("/operator");
  });

  it("вторая ступень уже пройдена — сразу на next; гость — на вход", async () => {
    await operatorSession(new Date());
    expect(await redirectTarget(page())).toBe("/operator/money");
    freshBrowser();
    expect(await redirectTarget(page())).toBe("/login?next=%2Foperator%2Fmfa%3Fnext%3D%252Foperator%252Fmoney");
  });
});
