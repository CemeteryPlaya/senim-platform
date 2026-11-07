import { beforeEach, describe, expect, it, vi } from "vitest";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_INSTAGRAM = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54";

/** Подменяет window и navigator, затем заново подключает модуль: подписка на события идёт при импорте. */
async function loadStore(env: { userAgent: string; standalone?: boolean; navigatorStandalone?: boolean }) {
  vi.resetModules();
  const handlers = new Map<string, (event: Event) => void>();
  vi.stubGlobal("window", {
    addEventListener: (type: string, fn: (event: Event) => void) => handlers.set(type, fn),
    matchMedia: () => ({ matches: env.standalone ?? false, addEventListener: vi.fn(), removeEventListener: vi.fn() }),
  });
  vi.stubGlobal("navigator", { userAgent: env.userAgent, maxTouchPoints: 5, standalone: env.navigatorStandalone });
  const store = await import("./install-store");
  const prompt = vi.fn(async () => undefined);
  const beforeInstallPrompt = () => {
    const event = { preventDefault: vi.fn(), prompt, userChoice: Promise.resolve({ outcome: "accepted" as const }) };
    handlers.get("beforeinstallprompt")!(event as unknown as Event);
    return event;
  };
  return { store, handlers, prompt, beforeInstallPrompt };
}

describe("install-store", () => {
  beforeEach(() => vi.unstubAllGlobals());

  it("beforeinstallprompt пойман — «prompt», событие гасится (своя кнопка вместо плашки Chrome), клик вызывает prompt()", async () => {
    const { store, prompt, beforeInstallPrompt } = await loadStore({ userAgent: ANDROID });
    expect(store.currentInstallMethod()).toBe("none");
    const event = beforeInstallPrompt();
    expect(event.preventDefault).toHaveBeenCalled();
    expect(store.currentInstallMethod()).toBe("prompt");
    await store.promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(store.currentInstallMethod()).toBe("none");
  });

  it("appinstalled убирает предложение", async () => {
    const { store, handlers, beforeInstallPrompt } = await loadStore({ userAgent: ANDROID });
    beforeInstallPrompt();
    handlers.get("appinstalled")!({} as Event);
    expect(store.currentInstallMethod()).toBe("none");
  });

  it("открыто как приложение (display-mode или navigator.standalone) — «none», даже с событием", async () => {
    const a = await loadStore({ userAgent: ANDROID, standalone: true });
    a.beforeInstallPrompt();
    expect(a.store.currentInstallMethod()).toBe("none");
    const b = await loadStore({ userAgent: IPHONE, navigatorStandalone: true });
    expect(b.store.currentInstallMethod()).toBe("none");
  });

  it("iPhone Safari — «ios-hint»; встроенный браузер Instagram — «open-in-browser»", async () => {
    expect((await loadStore({ userAgent: IPHONE })).store.currentInstallMethod()).toBe("ios-hint");
    expect((await loadStore({ userAgent: IPHONE_INSTAGRAM })).store.currentInstallMethod()).toBe("open-in-browser");
  });
});
