import { isRedirectError } from "next/dist/client/components/redirect-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { CONSENT_DOCUMENTS } from "@/i18n/ru/consent";
import { ConsentKind } from "@/gen/senim/identity/v1/identity_pb";
import { consentTextSha256, getCurrentUser } from "@/modules/identity";
import type { ActionResult } from "@/platform/action";
import { freshBrowser, setEnv } from "../../../../../test/factories/identity";
import { FAKE_OTP_CODE, identityFake } from "../../../../../test/stubs/identity";
import { chooseRoleAction, requestCodeAction, verifyCodeAction } from "../login/actions";
import { grantConsentAction } from "./actions";

vi.mock("next/headers", async () => (await import("../../../../../test/factories/identity")).nextHeadersMock);

const t = ru.app.onboarding.consent;
const PD = CONSENT_DOCUMENTS.PD_PROCESSING;
const ORIGINAL = { version: PD.version, sections: PD.sections };
const NEXT = "/v2/deals/1";

beforeEach(() => {
  freshBrowser({ "user-agent": "vitest" });
  setEnv({ SMS_PROVIDER: "mock" });
});
afterEach(() => {
  Object.assign(PD, ORIGINAL);
});

/** Итог действия: адрес перехода (redirect) или результат. */
async function run<T>(p: Promise<ActionResult<T>>): Promise<{ redirect: string } | ActionResult<T>> {
  try {
    return await p;
  } catch (e) {
    if (!isRedirectError(e)) throw e;
    return { redirect: e.digest.split(";")[2] };
  }
}

/** Вход новым номером через экран входа v2: человек в сессии, согласия ещё нет. */
async function signInNewcomer(phone: string) {
  await run(requestCodeAction({ phone }));
  await run(verifyCodeAction({ phone, code: FAKE_OTP_CODE, next: "" }));
  return (await getCurrentUser())!;
}

describe("grantConsentAction", () => {
  it("записывает согласие текущей редакции с версией и хэшем текста и ведёт на знакомство с возвратом", async () => {
    const user = await signInNewcomer("+77000007801");

    expect(await run(grantConsentAction({ agreed: "on", version: PD.version, next: NEXT }))).toEqual({
      redirect: `/v2/welcome?next=${encodeURIComponent(NEXT)}`,
    });

    const [record] = identityFake.consentsOf(user.id);
    expect(record).toMatchObject({ kind: ConsentKind.PD_PROCESSING, version: PD.version, textSha256: consentTextSha256("PD_PROCESSING"), channel: "otp_session" });
    expect(record?.purposes).toEqual(PD.purposes);
  });

  it("без next — на знакомство без параметра; чужой next отбрасывается", async () => {
    await signInNewcomer("+77000007802");
    expect(await run(grantConsentAction({ agreed: "on", version: PD.version, next: "//evil.example/v2" }))).toEqual({ redirect: "/v2/welcome" });
  });

  it("без отметки — ошибка у поля, согласие не записывается", async () => {
    const user = await signInNewcomer("+77000007803");
    const res = await run(grantConsentAction({ version: PD.version, next: "" } as never));
    expect(res).toMatchObject({ ok: false, code: "VALIDATION", fieldErrors: { agreed: [t.errors.required] } });
    expect(identityFake.consentsOf(user.id)).toHaveLength(0);
  });

  it("гость — UNAUTHENTICATED (форма уводит на вход)", async () => {
    expect(await run(grantConsentAction({ agreed: "on", version: PD.version }))).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
  });

  it("двойное нажатие — одна запись согласия", async () => {
    const user = await signInNewcomer("+77000007804");
    await Promise.allSettled([
      run(grantConsentAction({ agreed: "on", version: PD.version })),
      run(grantConsentAction({ agreed: "on", version: PD.version })),
    ]);
    expect(identityFake.consentsOf(user.id)).toHaveLength(1);
  });

  it("текст обновился между показом и нажатием — CONFLICT «текст обновился», согласие не записано", async () => {
    const user = await signInNewcomer("+77000007805");
    const shown = PD.version;
    Object.assign(PD, { version: "2099-01-01-t1" });
    const res = await run(grantConsentAction({ agreed: "on", version: shown }));
    expect(res).toMatchObject({ ok: false, code: "CONFLICT", error: ru.consent.errors.versionChanged });
    expect(identityFake.consentsOf(user.id)).toHaveLength(0);
  });

  it("выбравший «Я мастер» после согласия идёт на знакомство, а не мимо него; выбор сохраняется до конца шагов", async () => {
    await run(chooseRoleAction({ role: "executor", next: "" }));
    await signInNewcomer("+77000007806");
    expect(await run(grantConsentAction({ agreed: "on", version: PD.version, next: "" }))).toEqual({ redirect: "/v2/welcome" });
  });
});
