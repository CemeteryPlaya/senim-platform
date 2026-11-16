import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import * as operator from "@/modules/operator";
import { totpNow } from "../../../../../e2e/totp";
import { makeClient, makeOperator } from "../../../../../test/factories";
import { freshBrowser } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import { confirmEnrollmentAction, verifySecondFactorAction } from "./mfa/actions";
import { MfaForm } from "./mfa/MfaForm";
import MfaPage from "./mfa/page";
import OperatorHome from "./page";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
// Число документов мастеров приходит из identity; тест подменяет его, чтобы проверить «нет связи».
vi.mock("@/modules/operator", async (original) => {
  const real = await original<typeof import("@/modules/operator")>();
  return { ...real, kycQueueSize: vi.fn(real.kycQueueSize) };
});

const MIN = 60_000;

beforeEach(() => freshBrowser());
afterEach(() => vi.clearAllMocks());

/** Куда ведёт redirect() из next/navigation (он бросает ошибку с digest); `null` — перехода нет. */
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

/** Оператор с подключённым приложением; mfaVerifiedAt — момент второго шага этой сессии (null — вошёл только по SMS). */
async function operatorSession(mfaVerifiedAt: Date | null) {
  const op = await makeOperator();
  await signInAs(op, undefined, { mfaVerifiedAt });
  const secret = identityFake.enrollTotp(op.id);
  return { op, secret };
}

type FormProps = { next: string | null; enrollment: { secret: string; qrSrc: string } | null };
const page = (next?: string) => MfaPage({ searchParams: Promise.resolve(next === undefined ? {} : { next }) });
async function formOf(p: ReturnType<typeof page>): Promise<FormProps> {
  const el = (await p) as ReactElement<FormProps>;
  expect(el.type).toBe(MfaForm);
  return el.props;
}

describe("экран /v2/operator/mfa", () => {
  it("приложение не подключено — QR-код (SVG) и ключ; первый верный код подключает и ведёт на next v2", async () => {
    const op = await makeOperator();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    const props = await formOf(page("/v2/operator/money"));
    expect(props.next).toBe("/v2/operator/money");
    const secret = props.enrollment?.secret ?? "";
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(props.enrollment?.qrSrc).toMatch(/^data:image\/svg\+xml;base64,/);

    expect(await redirectTarget(confirmEnrollmentAction({ code: totpNow(secret), next: "/v2/operator/money" }))).toBe("/v2/operator/money");
    expect(identityFake.factorState(op.id)).toBe("confirmed");
  });

  it("подключено — только поле кода; адрес возврата не v2 или чужой — главная оператора", async () => {
    const { secret } = await operatorSession(null);
    expect(await formOf(page("https://evil.example"))).toEqual({ next: null, enrollment: null });
    expect(await formOf(page("/operator/money"))).toMatchObject({ next: null });
    expect(await redirectTarget(verifySecondFactorAction({ code: totpNow(secret), next: "//evil.example" }))).toBe("/v2/operator");
  });

  it("неверный код — ошибка у поля кода с числом попыток, перехода нет", async () => {
    const { secret } = await operatorSession(null);
    const wrong = totpNow(secret) === "000000" ? "111111" : "000000";
    expect(await verifySecondFactorAction({ code: wrong, next: "/v2/operator" })).toMatchObject({
      ok: false,
      code: "VALIDATION",
      fieldErrors: { code: [ru.identity.mfa.errors.wrongCode(4)] },
    });
  });

  it("код перед действием с деньгами (протокол формы, без next) — без перехода, сессия «пройдено сейчас»", async () => {
    const { secret } = await operatorSession(new Date(Date.now() - 10 * MIN));
    expect(await verifySecondFactorAction({ code: totpNow(secret) })).toEqual({ ok: true, data: undefined });
  });

  it("второй шаг уже пройден — сразу на next; гость — на вход v2 с возвратом на этот экран", async () => {
    await operatorSession(new Date());
    expect(await redirectTarget(page("/v2/operator/money"))).toBe("/v2/operator/money");
    expect(await redirectTarget(page())).toBe("/v2/operator");
    freshBrowser();
    expect(await redirectTarget(page("/v2/operator/money"))).toBe(`/v2/login?next=${encodeURIComponent("/v2/operator/money")}`);
  });

  it("не оператор — экран не нужен: уходит дальше по своим шагам, код не спрашивается", async () => {
    const client = await makeClient();
    await signInAs(client);
    const target = await redirectTarget(page("/v2/operator/money"));
    expect(target).not.toBeNull();
    expect(target).not.toContain("/operator/mfa");
    // Действия экрана тоже не для него.
    expect(await verifySecondFactorAction({ code: "123456" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});

describe("главная оператора /v2/operator", () => {
  const render = async () => renderToStaticMarkup((await OperatorHome()) as ReactElement);

  it("без второго шага — на экран кода v2 с возвратом на главную", async () => {
    await operatorSession(null);
    expect(await redirectTarget(OperatorHome())).toBe(`/v2/operator/mfa?next=${encodeURIComponent("/v2/operator")}`);
  });

  it("гость — на вход с возвратом; не оператор — в свой дом", async () => {
    expect(await redirectTarget(OperatorHome())).toBe(`/v2/login?next=${encodeURIComponent("/v2/operator")}`);
    const client = await makeClient();
    await signInAs(client);
    const target = await redirectTarget(OperatorHome());
    expect(target).not.toBeNull();
    expect(target).not.toContain("/v2/operator");
  });

  it("второй шаг пройден (даже давно) — один <h1>, «что требует внимания» и сводка; без главной кнопки", async () => {
    await operatorSession(new Date(Date.now() - 60 * MIN));
    const out = await render();
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(ru.app.operator.home.title);
    expect(out).toContain(ru.app.operator.home.todo);
    expect(out).toContain(ru.app.operator.home.summary);
    expect(out).not.toContain("data-primary-action");
  });

  it("identity не ответил о документах мастеров — «—» с пояснением, остальная главная на месте", async () => {
    await operatorSession(new Date());
    vi.mocked(operator.kycQueueSize).mockResolvedValueOnce(null);
    const out = await render();
    expect(out).toContain(ru.app.operator.home.tiles.kycUnavailable);
    expect(out).toContain(">—<");
    expect(out).toContain(ru.app.operator.home.tiles.money);
  });
});
