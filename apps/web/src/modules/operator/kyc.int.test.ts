import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeOperator } from "../../../test/factories";
import { freshBrowser } from "../../../test/factories/identity";
import { signInAs } from "../../../test/factories/session";
import { identityFake } from "../../../test/stubs/identity";
import { kycQueueSize } from "./kyc";

vi.mock("next/headers", async () => (await import("../../../test/factories/identity")).nextHeadersMock);

beforeEach(() => freshBrowser());

/** Главная оператора (Ruling AB): число очереди KYC из identity; identity недоступен — плитка без числа, а не сбой. */
describe("число очереди KYC для главной оператора", () => {
  it("identity отвечает — число; недоступен — null; отказ по второй ступени — как есть", async () => {
    const operator = await makeOperator();
    await signInAs(operator);
    expect(await kycQueueSize(operator)).toBe(0);
    identityFake.failNextUnavailable();
    expect(await kycQueueSize(operator)).toBeNull();

    const smsOnly = await makeOperator();
    await signInAs(smsOnly, undefined, { mfaVerifiedAt: null });
    await expect(kycQueueSize(smsOnly)).rejects.toMatchObject({ code: "MFA_REQUIRED" });
  });
});
