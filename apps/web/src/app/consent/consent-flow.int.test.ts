import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { ConsentKind, Role as ProtoRole } from "@/gen/senim/identity/v1/identity_pb";
import { consentTextSha256, getCurrentUser, getMyData, requireUser, requireUserPage, sessionCookieName } from "@/modules/identity";
import { AppError } from "@/platform/errors";
import { makeClient, makeOperator } from "../../../test/factories";
import { freshBrowser, putCookie, setEnv } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { FAKE_OTP_CODE, fakeRevocationDue, identityFake } from "../../../test/stubs/identity";
import { requestCodeAction, verifyCodeAction } from "../login/actions";
import { resolveRevocationAction } from "../operator/consents/actions";
import ConsentRevocationsPage from "../operator/consents/page";
import { revokeConsentAction } from "../profile/data/actions";
import MyDataPage from "../profile/data/page";
import { RevokeForm } from "../profile/data/RevokeForm";
import WelcomePage from "../welcome/page";
import { grantConsentAction } from "./actions";
import { ConsentForm } from "./ConsentForm";
import ConsentPage from "./page";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

const PD = CONSENT_DOCUMENTS.PD_PROCESSING;
const ORIGINAL = { version: PD.version, sections: PD.sections };
// Понедельник, 10:00 по Алматы: срок отзыва — понедельник через три недели (15 рабочих дней).
const MONDAY = new Date("2026-11-09T05:00:00Z");

beforeEach(() => {
  freshBrowser();
  setEnv({ DEMO_MODE: "true", SMS_PROVIDER: "mock" });
});
afterEach(() => {
  Object.assign(PD, ORIGINAL);
});

/** Куда ведёт redirect() из next/navigation (он бросает ошибку с digest). */
async function redirectTarget(p: Promise<unknown> | (() => unknown)): Promise<string | null> {
  try {
    await (typeof p === "function" ? p() : p);
    return null;
  } catch (e) {
    const digest = (e as { digest?: string }).digest ?? "";
    if (!digest.startsWith("NEXT_REDIRECT")) throw e;
    return digest.split(";")[2] ?? null;
  }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  if (!(e instanceof AppError)) throw new Error(`ожидалась AppError, получено: ${String(e)}`);
  return e.code;
}

/** Все элементы дерева React (страница — серверный компонент, его результат — дерево элементов). */
function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  return [el, ...elements(el.props.children)];
}

/** Вход новым номером по SMS через экран входа (как в браузере). */
async function signInNewcomer(phone: string, next: string | null) {
  await requestCodeAction({ phone });
  return redirectTarget(verifyCodeAction({ phone, code: FAKE_OTP_CODE, next }));
}

describe("экран согласия после входа", () => {
  it("новый пользователь после входа — на /consent с возвратом; после согласия — на next; запись несёт версию и хэш текста", async () => {
    expect(await signInNewcomer("+77000007701", "/requests")).toBe("/requests");
    // Страница, на которую вёл вход, уводит на согласие с возвратом; действия — CONSENT_REQUIRED.
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/consent?next=%2Frequests");
    expect(await codeOf(requireUser("CLIENT"))).toBe("CONSENT_REQUIRED");
    // ФИО и ИИН собираются только после согласия: знакомство тоже ведёт на согласие.
    expect(await redirectTarget(WelcomePage({ searchParams: Promise.resolve({}) }))).toBe("/consent?next=%2Fwelcome");

    const page = await ConsentPage({ searchParams: Promise.resolve({ next: "/requests" }) });
    const form = elements(page).find((el) => el.type === ConsentForm) as ReactElement<{ next: string | null; updated: boolean }>;
    expect(form.props).toMatchObject({ next: "/requests", updated: false });

    expect(await redirectTarget(grantConsentAction({ next: "/requests", version: PD.version }))).toBe("/requests");

    const user = (await getCurrentUser())!;
    const [record] = identityFake.consentsOf(user.id);
    expect(record).toMatchObject({ kind: ConsentKind.PD_PROCESSING, version: PD.version, textSha256: consentTextSha256("PD_PROCESSING"), channel: "otp_session", referenceId: "" });
    expect(record?.purposes).toEqual(PD.purposes);
    // Дальше — знакомство (ФИО и ИИН), а не согласие.
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/welcome?next=%2Frequests");
    // Согласие уже есть — экран согласия ведёт дальше; адрес возврата — только внутри сайта.
    expect(await redirectTarget(ConsentPage({ searchParams: Promise.resolve({ next: "//evil.example" }) }))).toBe("/requests");
  });

  it("гость на /consent — на вход с возвратом на согласие", async () => {
    expect(await redirectTarget(ConsentPage({ searchParams: Promise.resolve({ next: "/deals" }) }))).toBe("/login?next=%2Fconsent%3Fnext%3D%252Fdeals");
  });

  it("двойное нажатие «Даю согласие» — одна запись", async () => {
    await signInNewcomer("+77000007702", null);
    const user = (await getCurrentUser())!;
    await Promise.allSettled([grantConsentAction({ next: null, version: PD.version }), grantConsentAction({ next: null, version: PD.version })]);
    expect(identityFake.consentsOf(user.id)).toHaveLength(1);
  });

  it("новая редакция текста: следующий запрос уводит на согласие с возвратом на ту же страницу, новая запись — с новыми версией и хэшем", async () => {
    const client = await makeClient();
    await signInAs(client);
    expect(await redirectTarget(requireUserPage("/deals?tab=active", "CLIENT"))).toBeNull();

    // Подмена текста в ru/consent.ts: новая версия и ещё один раздел.
    Object.assign(PD, { version: "2099-01-01-t1", sections: [...ORIGINAL.sections, { heading: "13. Новый раздел", body: "Текст новой редакции" }] });

    expect(await redirectTarget(requireUserPage("/deals?tab=active", "CLIENT"))).toBe("/consent?next=%2Fdeals%3Ftab%3Dactive");
    expect(await codeOf(requireUser("CLIENT"))).toBe("CONSENT_REQUIRED");
    const page = await ConsentPage({ searchParams: Promise.resolve({ next: "/deals?tab=active" }) });
    const form = elements(page).find((el) => el.type === ConsentForm) as ReactElement<{ updated: boolean }>;
    expect(form.props.updated).toBe(true);

    expect(await redirectTarget(grantConsentAction({ next: "/deals?tab=active", version: PD.version }))).toBe("/deals?tab=active");
    const records = identityFake.consentsOf(client.id);
    expect(records.map((r) => r.version)).toEqual([ORIGINAL.version, "2099-01-01-t1"]);
    expect(records[1]?.textSha256).toBe(consentTextSha256("PD_PROCESSING"));
    expect(records[1]?.textSha256).not.toBe(records[0]?.textSha256);
    expect(await redirectTarget(requireUserPage("/deals?tab=active", "CLIENT"))).toBeNull();
  });

  it("редакция сменилась между показом и нажатием — CONFLICT «текст обновился», записи нет; новая редакция — записывается", async () => {
    await signInNewcomer("+77000007703", null);
    const user = (await getCurrentUser())!;
    const shown = PD.version;
    Object.assign(PD, { version: "2099-01-01-t2", sections: [...ORIGINAL.sections, { heading: "13. Новый раздел", body: "Текст" }] });

    expect(await grantConsentAction({ next: null, version: shown })).toEqual({ ok: false, code: "CONFLICT", error: ru.consent.errors.versionChanged });
    expect(identityFake.consentsOf(user.id)).toEqual([]);
    expect(identityFake.calls.filter((c) => c.method === "grantConsent")).toHaveLength(0);

    // Перерисованный экран показывает новую редакцию — с ней согласие проходит, в записи её версия и хэш.
    expect(await redirectTarget(grantConsentAction({ next: null, version: "2099-01-01-t2" }))).toBe("/requests");
    expect(identityFake.consentsOf(user.id).map((c) => [c.version, c.textSha256])).toEqual([["2099-01-01-t2", consentTextSha256("PD_PROCESSING")]]);
  });

  it("Ruling AE: при открытой заявке на отзыв новая редакция не требуется до решения оператора; после COMPLETED — экран согласия", async () => {
    const client = await makeClient();
    const token = await signInAs(client);
    await revokeConsentAction({});
    Object.assign(PD, { version: "2099-01-01-t3" });

    identityFake.calls.length = 0;
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBeNull();
    await expect(requireUser("CLIENT")).resolves.toMatchObject({ consentRevocationOpen: true });
    // Лишний ListMyConsents — только на пути «прежняя редакция».
    expect(identityFake.calls.filter((c) => c.method === "listMyConsents").length).toBeGreaterThan(0);
    expect(await redirectTarget(ConsentPage({ searchParams: Promise.resolve({ next: "/requests" }) }))).toBe("/requests");

    const [rev] = identityFake.revocationsOf(client.id);
    freshBrowser();
    await signInAs(await makeOperator());
    await resolveRevocationAction({ revocationId: rev!.id, decision: "COMPLETED" });
    freshBrowser();
    putCookie(sessionCookieName(), token);
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/consent?next=%2Frequests");
  });

  it("согласие текущей редакции — без лишнего ListMyConsents", async () => {
    await signInAs(await makeClient());
    identityFake.calls.length = 0;
    await requireUser("CLIENT");
    expect(identityFake.calls.map((c) => c.method)).toEqual(["authenticate"]);
  });

  it("сотруднику площадки экран согласия не нужен", async () => {
    const op = await makeOperator();
    identityFake.addUser({ id: op.id, phone: op.phone, defaultRole: ProtoRole.OPERATOR, consent: false });
    await signInAs(op);
    expect((await getCurrentUser())?.consents).toEqual([]);
    await expect(requireUser("OPERATOR")).resolves.toMatchObject({ role: "OPERATOR" });
  });
});

describe("«Мои данные» и отзыв согласия", () => {
  async function signedInClient() {
    const client = await makeClient();
    const token = await signInAs(client);
    return { client, token };
  }

  it("отзыв — заявка со сроком 15 рабочих дней; согласие действует, страницы открываются; кнопки отзыва больше нет", async () => {
    identityFake.now = () => MONDAY;
    const { client } = await signedInClient();
    const before = await MyDataPage();
    expect(elements(before).some((el) => el.type === RevokeForm)).toBe(true);

    const res = await revokeConsentAction({});
    expect(res).toEqual({ ok: true, data: { status: "REQUESTED", dueAt: new Date("2026-11-30T05:00:00Z") } });
    expect(fakeRevocationDue(MONDAY)).toEqual(new Date("2026-11-30T05:00:00Z"));

    // Ruling P: до решения оператора согласие действует — человек не уходит на экран согласия.
    expect(await redirectTarget(requireUserPage("/profile/data", "CLIENT"))).toBeNull();
    const data = await getMyData((await getCurrentUser())!);
    expect(data.consents.map((c) => c.kind)).toEqual(["PD_PROCESSING"]);
    expect(data.revocation).toMatchObject({ status: "REQUESTED", dueAt: new Date("2026-11-30T05:00:00Z"), decidedAt: null, reason: null });
    // Ruling R: пока заявка открыта — ни повторного отзыва, ни «дать согласие заново».
    expect(elements(await MyDataPage()).some((el) => el.type === RevokeForm)).toBe(false);
    expect(await redirectTarget(ConsentPage({ searchParams: Promise.resolve({}) }))).toBe("/requests");
    // Повтор — та же заявка.
    await revokeConsentAction({});
    expect(identityFake.revocationsOf(client.id)).toHaveLength(1);
  });

  it("оператор исполняет отзыв: согласие отозвано — человек уходит на экран согласия; повторное решение — CONFLICT", async () => {
    const { client, token } = await signedInClient();
    await revokeConsentAction({});
    const [rev] = identityFake.revocationsOf(client.id);

    freshBrowser();
    const op = await makeOperator();
    await signInAs(op);
    const queue = elements(await ConsentRevocationsPage());
    expect(queue.some((el) => (el.props as { revocationId?: string }).revocationId === rev!.id)).toBe(true);

    expect(await resolveRevocationAction({ revocationId: rev!.id, decision: "COMPLETED" })).toEqual({ ok: true, data: undefined });
    const again = await resolveRevocationAction({ revocationId: rev!.id, decision: "REFUSED", reason: "Идёт сделка" });
    expect(again).toMatchObject({ ok: false, code: "CONFLICT" });

    freshBrowser();
    putCookie(sessionCookieName(), token);
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBe("/consent?next=%2Frequests");
    expect(await codeOf(requireUser("CLIENT"))).toBe("CONSENT_REQUIRED");
  });

  it("оператор отказывает с причиной (3–500 символов): согласие остаётся, «Мои данные» показывают отказ и причину", async () => {
    const { client, token } = await signedInClient();
    await revokeConsentAction({});
    const [rev] = identityFake.revocationsOf(client.id);

    freshBrowser();
    await signInAs(await makeOperator());
    expect(await resolveRevocationAction({ revocationId: rev!.id, decision: "REFUSED", reason: " ок " })).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await resolveRevocationAction({ revocationId: rev!.id, decision: "REFUSED", reason: "Идёт сделка — данные нужны для неё" })).toEqual({ ok: true, data: undefined });

    freshBrowser();
    putCookie(sessionCookieName(), token);
    expect(await redirectTarget(requireUserPage("/requests", "CLIENT"))).toBeNull();
    const data = await getMyData((await getCurrentUser())!);
    expect(data.revocation).toMatchObject({ status: "REFUSED", reason: "Идёт сделка — данные нужны для неё" });
    // Отказ — можно отозвать снова.
    expect(elements(await MyDataPage()).some((el) => el.type === RevokeForm)).toBe(true);
  });

  it("очередь и решение — только оператору", async () => {
    await signedInClient();
    expect(await resolveRevocationAction({ revocationId: "00000000-0000-4000-8000-000000000001", decision: "COMPLETED" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
  });
});
