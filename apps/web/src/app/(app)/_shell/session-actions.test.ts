import { isRedirectError } from "next/dist/client/components/redirect-error";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ru } from "@/i18n/ru";
import { AppError } from "@/platform/errors";

const h = vi.hoisted(() => ({ endSession: vi.fn<() => Promise<void>>() }));

vi.mock("@/modules/identity", () => ({ endSession: h.endSession }));

const { logout } = await import("./session-actions");

beforeEach(() => {
  h.endSession.mockReset();
});

describe("logout", () => {
  it("завершает сессию и уводит на главную v2 (страницы входа в v2 пока нет)", async () => {
    h.endSession.mockResolvedValue(undefined);
    const thrown = await logout({}).then(
      () => null,
      (e: unknown) => e,
    );
    expect(h.endSession).toHaveBeenCalledTimes(1);
    expect(isRedirectError(thrown)).toBe(true);
    expect((thrown as { digest: string }).digest).toContain(";/v2;");
  });

  it("identity недоступен — ошибка «сервис недоступен», без перехода", async () => {
    h.endSession.mockRejectedValue(new AppError("UNAVAILABLE", ru.common.errors.unavailable));
    await expect(logout({})).resolves.toEqual({ ok: false, code: "UNAVAILABLE", error: ru.common.errors.unavailable });
  });

  it("лишние поля во входе отклоняются схемой", async () => {
    const res = await logout({ everywhere: true } as never);
    expect(res).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(h.endSession).not.toHaveBeenCalled();
  });
});
