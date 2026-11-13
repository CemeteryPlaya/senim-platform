import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  set: vi.fn(),
  delete: vi.fn(),
  revalidatePath: vi.fn(),
  appEnv: "prod" as "dev" | "staging" | "prod",
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: h.set, delete: h.delete }) }));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/platform/env", () => ({ env: () => ({ APP_ENV: h.appEnv }) }));

const { chooseTheme, setTheme } = await import("./theme-actions");

const YEAR = 60 * 60 * 24 * 365;

beforeEach(() => {
  vi.clearAllMocks();
  h.appEnv = "prod";
});

describe("setTheme", () => {
  it.each(["light", "dark"] as const)("%s: кука theme на год, SameSite=Lax, Secure вне dev, на весь сайт", async (theme) => {
    await expect(setTheme(theme)).resolves.toEqual({ ok: true, data: undefined });
    expect(h.set).toHaveBeenCalledTimes(1);
    expect(h.set).toHaveBeenCalledWith("theme", theme, { maxAge: YEAR, sameSite: "lax", secure: true, httpOnly: true, path: "/" });
    expect(h.delete).not.toHaveBeenCalled();
  });

  it("в dev кука без Secure (http://localhost)", async () => {
    h.appEnv = "dev";
    await setTheme("dark");
    expect(h.set).toHaveBeenCalledWith("theme", "dark", expect.objectContaining({ secure: false }));
  });

  it("«Авто» (system) удаляет куку", async () => {
    await setTheme("system");
    expect(h.delete).toHaveBeenCalledWith({ name: "theme", path: "/" });
    expect(h.set).not.toHaveBeenCalled();
  });

  it("после смены layout v2 перерисовывается", async () => {
    await setTheme("light");
    expect(h.revalidatePath).toHaveBeenCalledWith("/(app)", "layout");
  });

  it.each([["blue"], ["<script>"], [""], [undefined], [42]])("неверное значение %s — результат VALIDATION, без изменений и без исключения (не 500)", async (bad) => {
    await expect(setTheme(bad as never)).resolves.toMatchObject({ ok: false, code: "VALIDATION" });
    expect(h.set).not.toHaveBeenCalled();
    expect(h.delete).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("chooseTheme (форма переключателя)", () => {
  it("тема привязана через bind, как в ThemeSwitch: кука ставится", async () => {
    await expect(chooseTheme.bind(null, "dark")()).resolves.toBeUndefined();
    expect(h.set).toHaveBeenCalledWith("theme", "dark", expect.objectContaining({ httpOnly: true }));
  });

  it("неверное значение не бросает исключение и ничего не меняет", async () => {
    await expect(chooseTheme("blue" as never)).resolves.toBeUndefined();
    expect(h.set).not.toHaveBeenCalled();
    expect(h.delete).not.toHaveBeenCalled();
    expect(h.revalidatePath).not.toHaveBeenCalled();
  });
});
