import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ActionResult } from "@/platform/action";

// Хук без DOM: useState отдаёт шпионов-сеттеров (по порядку: error, fieldErrors), переход — сразу.
const setters: ReturnType<typeof vi.fn>[] = [];
vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  useState: (init: unknown) => {
    const set = vi.fn();
    setters.push(set);
    return [init, set];
  },
  useTransition: () => [false, (fn: () => Promise<void>) => void fn()],
}));
const router = { push: vi.fn(), refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const { useRunAction } = await import("./ActionButton");

const assign = vi.fn();
beforeEach(() => {
  setters.length = 0;
  vi.stubGlobal("window", { location: { pathname: "/requests/7", search: "?step=send", assign } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const failed = (code: "UNAUTHENTICATED" | "VALIDATION"): ActionResult<{ id: string }> => ({ ok: false, code, error: "Ошибка", fieldErrors: { name: ["нет"] } });

describe("useRunAction (requests/_parts) — ActionButton и формы заявки", () => {
  it("UNAUTHENTICATED: переход на вход с возвратом, ошибка не показывается, промис отдаёт результат", async () => {
    const result = failed("UNAUTHENTICATED");
    const { run } = useRunAction(async () => result);
    const [setError, setFieldErrors] = setters;

    await expect(run({})).resolves.toBe(result);

    expect(assign).toHaveBeenCalledWith("/login?next=%2Frequests%2F7%3Fstep%3Dsend");
    expect(setError.mock.calls).toEqual([[null]]); // только сброс перед запуском
    expect(setFieldErrors.mock.calls).toEqual([[undefined]]);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("другая ошибка: остаётся на месте, ошибка и поля показываются", async () => {
    const result = failed("VALIDATION");
    const { run } = useRunAction(async () => result);
    const [setError, setFieldErrors] = setters;

    await expect(run({})).resolves.toBe(result);

    expect(assign).not.toHaveBeenCalled();
    expect(setError).toHaveBeenLastCalledWith("Ошибка");
    expect(setFieldErrors).toHaveBeenLastCalledWith({ name: ["нет"] });
  });

  it("успех: переход по адресу из after, без входа", async () => {
    const { run } = useRunAction(async () => ({ ok: true, data: { id: "r1" } }), (d) => `/requests/${d.id}`);

    await run({});

    expect(router.push).toHaveBeenCalledWith("/requests/r1");
    expect(assign).not.toHaveBeenCalled();
  });
});
