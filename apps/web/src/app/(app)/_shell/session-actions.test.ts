import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({ endSession: vi.fn<() => Promise<void>>(), signOutEverywhere: vi.fn<() => Promise<void>>(), forgetRole: vi.fn<() => Promise<void>>() }));

vi.mock("@/modules/identity", () => ({ endSession: h.endSession, signOutEverywhere: h.signOutEverywhere }));
vi.mock("./role-cookie", () => ({ forgetRole: h.forgetRole }));

const { logout, logoutEverywhere } = await import("./session-actions");

beforeEach(() => {
  h.endSession.mockReset();
  h.signOutEverywhere.mockReset();
  h.forgetRole.mockReset().mockResolvedValue(undefined);
});

describe("logout", () => {
  it("завершает сессию, забывает выбор роли входа и уводит на вход v2", async () => {
    h.endSession.mockResolvedValue(undefined);
    const thrown = await logout({}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(h.endSession).toHaveBeenCalledTimes(1);
    expect(h.forgetRole).toHaveBeenCalledTimes(1);
    expect(isRedirectError(thrown)).toBe(true);
    expect((thrown as { digest: string }).digest).toContain(";/v2/login;");
  });

  it("identity недоступен — ошибка «сервис недоступен», без перехода", async () => {
    h.endSession.mockRejectedValue(new AppError("UNAVAILABLE", ru.common.errors.unavailable));
    await expect(logout({})).resolves.toEqual({ ok: false, code: "UNAVAILABLE", error: ru.common.errors.unavailable });
    expect(h.forgetRole).not.toHaveBeenCalled();
  });

  it("лишние поля во входе отклоняются схемой", async () => {
    const res = await logout({ everywhere: true } as never);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(h.endSession).not.toHaveBeenCalled();
  });
});

describe("logoutEverywhere", () => {
  it("завершает все сессии (не только эту), забывает роль и уводит на вход v2", async () => {
    h.signOutEverywhere.mockResolvedValue(undefined);
    const thrown = await logoutEverywhere({}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(h.signOutEverywhere).toHaveBeenCalledTimes(1);
    expect(h.endSession).not.toHaveBeenCalled();
    expect(h.forgetRole).toHaveBeenCalledTimes(1);
    expect((thrown as { digest: string }).digest).toContain(";/v2/login;");
  });

  it("identity недоступен — ошибка, роль не забывается, перехода нет", async () => {
    h.signOutEverywhere.mockRejectedValue(new AppError("UNAVAILABLE", ru.common.errors.unavailable));
    await expect(logoutEverywhere({})).resolves.toEqual({ ok: false, code: "UNAVAILABLE", error: ru.common.errors.unavailable });
    expect(h.forgetRole).not.toHaveBeenCalled();
  });
});
