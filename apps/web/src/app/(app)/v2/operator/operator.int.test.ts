import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import * as operator from "@/modules/operator";
import { totpNow } from "../../../../../e2e/totp";
import { makeAdmin, makeClient, makeOperator } from "../../../../../test/factories";
import { freshBrowser, putCookie } from "../../../../../test/factories/identity";
import { signInAs } from "../../../../../test/factories/session";
import { identityFake } from "../../../../../test/stubs/identity";
import { confirmTotpEnrollment, getCurrentUser, sessionCookieName, startTotpEnrollment } from "@/modules/identity";
import { confirmEnrollmentAction, verifySecondFactorAction } from "./mfa/actions";
import { MfaForm } from "./mfa/MfaForm";
import MfaPage from "./mfa/page";
import OperatorHome from "./page";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);
// Второй шаг меняет оболочку (сосредоточенная → с меню): действие просит перерисовать layout.
const h = vi.hoisted(() => ({ revalidated: [] as unknown[][] }));
vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => void h.revalidated.push(args) }));
// Число документов мастеров приходит из identity; тест подменяет его, чтобы проверить «нет связи».
vi.mock("@/modules/operator", async (original) => {
  const real = await original<typeof import("@/modules/operator")>();
  return { ...real, kycQueueSize: vi.fn(real.kycQueueSize) };
});

const MIN = 60_000;

beforeEach(() => {
  freshBrowser();
  h.revalidated = [];
});
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

  it("подключение устойчиво в пределах сессии: повторное открытие (обновление экрана) — тот же секрет; подключено — null", async () => {
    const op = await makeOperator();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    const first = (await formOf(page())).enrollment?.secret;
    const again = (await formOf(page())).enrollment?.secret;
    expect(first).toMatch(/^[A-Z2-7]{32}$/);
    expect(again).toBe(first);

    const user = await getCurrentUser();
    if (!user || !first) throw new Error("нет сессии или секрета");
    await confirmTotpEnrollment(user, totpNow(first));
    expect(identityFake.factorState(op.id)).toBe("confirmed");
    expect(await startTotpEnrollment(user)).toBeNull();
  });

  it("секрет сессии заменён в другой сессии — экран выдаёт новый действующий секрет, а не ошибку", async () => {
    const op = await makeOperator();
    const mine = await signInAs(op, undefined, { mfaVerifiedAt: null });
    const first = (await formOf(page())).enrollment?.secret;
    // Другая сессия того же оператора начинает подключение — секрет первой перестаёт действовать.
    freshBrowser();
    await signInAs(op, undefined, { mfaVerifiedAt: null });
    const other = (await formOf(page())).enrollment?.secret;
    expect(other).not.toBe(first);
    // Вернулись в первую сессию: её ключ указывает на заменённый секрет — выдаётся новый, им можно подключиться.
    freshBrowser();
    putCookie(sessionCookieName(), mine);
    const renewed = (await formOf(page())).enrollment?.secret ?? "";
    expect(renewed).not.toBe(first);
    expect(await redirectTarget(confirmEnrollmentAction({ code: totpNow(renewed), next: "/v2/operator" }))).toBe("/v2/operator");
  });

  it("подключено — только поле кода; адрес возврата не v2 или чужой — главная оператора", async () => {
    const { secret } = await operatorSession(null);
    expect(await formOf(page("https://evil.example"))).toEqual({ next: null, enrollment: null });
    expect(await formOf(page("/operator/money"))).toMatchObject({ next: null });
    expect(await redirectTarget(verifySecondFactorAction({ code: totpNow(secret), next: "//evil.example" }))).toBe("/v2/operator");
  });

  it("после второго шага (подключение и код) оболочка перерисовывается: без этого шапка остаётся без меню до перезагрузки", async () => {
    const { secret } = await operatorSession(null);
    await redirectTarget(verifySecondFactorAction({ code: totpNow(secret), next: "/v2/operator" }));
    expect(h.revalidated).toContainEqual(["/(app)", "layout"]);

    h.revalidated = [];
    const fresh = await makeOperator();
    await signInAs(fresh, undefined, { mfaVerifiedAt: null });
    const enrollment = (await formOf(page())).enrollment;
    await redirectTarget(confirmEnrollmentAction({ code: totpNow(enrollment?.secret ?? ""), next: "" }));
    expect(h.revalidated).toContainEqual(["/(app)", "layout"]);
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

describe("экран /v2/operator/mfa для администратора (общий экран второго фактора)", () => {
  it("вошёл по SMS, приложение не подключено — QR-код; первый верный код подключает и ведёт в админку", async () => {
    const admin = await makeAdmin();
    await signInAs(admin, undefined, { mfaVerifiedAt: null });
    const secret = (await formOf(page())).enrollment?.secret ?? "";
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(await redirectTarget(confirmEnrollmentAction({ code: totpNow(secret), next: "" }))).toBe("/v2/admin");
    expect(identityFake.factorState(admin.id)).toBe("confirmed");
  });

  it("приложение подключено — код ведёт на next или домой (админка), чужой адрес возврата — домой", async () => {
    const admin = await makeAdmin();
    await signInAs(admin, undefined, { mfaVerifiedAt: null });
    const secret = identityFake.enrollTotp(admin.id);
    expect(await formOf(page("/v2/admin/data"))).toEqual({ next: "/v2/admin/data", enrollment: null });
    expect(await redirectTarget(verifySecondFactorAction({ code: totpNow(secret), next: "//evil.example" }))).toBe("/v2/admin");
  });

  it("второй шаг пройден — экран уходит в админку; раздел оператора администратору закрыт — в свой дом", async () => {
    const admin = await makeAdmin();
    await signInAs(admin);
    expect(await redirectTarget(OperatorHome())).toBe("/v2/admin");
    expect(await redirectTarget(page())).toBe("/v2/admin");
    expect(await redirectTarget(page("/v2/admin/data"))).toBe("/v2/admin/data");
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

  it("второй шаг пройден (даже давно) — один <h1> и «что требует внимания»; без сводки и без главной кнопки", async () => {
    await operatorSession(new Date(Date.now() - 60 * MIN));
    const out = await render();
    expect(out.match(/<h1/g)).toHaveLength(1);
    expect(out).toContain(ru.app.operator.home.title);
    expect(out).toContain(ru.app.operator.home.todo);
    expect(out).not.toContain("Сводка");
    expect(out).not.toContain("data-primary-action");
  });

  it("identity не ответил о документах мастеров — строка «нет связи», остальная главная на месте", async () => {
    await operatorSession(new Date());
    vi.mocked(operator.kycQueueSize).mockResolvedValueOnce(null);
    const out = await render();
    expect(out).toContain(ru.app.operator.home.kycUnavailable);
    expect(out).toContain(ru.app.operator.home.todo);
  });
});
