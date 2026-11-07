import { describe, expect, it } from "vitest";
import { canAddToHomeScreenOnIos, DISMISS_KEY, installMethod, isInAppBrowser, isStandalone, readDismissed, saveDismissed, showBanner, showHeaderItem } from "./install-offer";

const UA = {
  iphoneSafari: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iphoneChrome: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iphoneInstagram: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 337.0.3.23.54",
  ipadOs: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidInstagram: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 Instagram 337.0.0.0.77",
  androidChrome: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
};

describe("canAddToHomeScreenOnIos", () => {
  it("iPhone в Safari и в Chrome — да (меню «Поделиться» есть в обоих)", () => {
    expect(canAddToHomeScreenOnIos(UA.iphoneSafari, 5)).toBe(true);
    expect(canAddToHomeScreenOnIos(UA.iphoneChrome, 5)).toBe(true);
  });

  it("iPad с iPadOS притворяется Mac, но у него есть касания — да", () => {
    expect(canAddToHomeScreenOnIos(UA.ipadOs, 5)).toBe(true);
  });

  it("Mac без сенсорного экрана — нет", () => {
    expect(canAddToHomeScreenOnIos(UA.macSafari, 0)).toBe(false);
  });

  it("встроенный браузер Instagram или Telegram на iPhone — нет: там нельзя добавить на экран", () => {
    expect(canAddToHomeScreenOnIos(UA.iphoneInstagram, 5)).toBe(false);
  });

  it("Android — нет: там кнопка через beforeinstallprompt", () => {
    expect(canAddToHomeScreenOnIos(UA.androidChrome, 5)).toBe(false);
  });
});

describe("isStandalone", () => {
  it("уже открыто как приложение: display-mode standalone или navigator.standalone в iOS", () => {
    expect(isStandalone({ displayModeStandalone: true, navigatorStandalone: undefined })).toBe(true);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: false })).toBe(false);
    expect(isStandalone({ displayModeStandalone: false, navigatorStandalone: undefined })).toBe(false);
  });
});

describe("isInAppBrowser", () => {
  it("Instagram, Telegram и т. п. на iPhone и Android — да", () => {
    expect(isInAppBrowser(UA.iphoneInstagram, 5)).toBe(true);
    expect(isInAppBrowser(UA.androidInstagram, 5)).toBe(true);
  });

  it("обычные Safari и Chrome — нет", () => {
    expect(isInAppBrowser(UA.iphoneSafari, 5)).toBe(false);
    expect(isInAppBrowser(UA.iphoneChrome, 5)).toBe(false);
    expect(isInAppBrowser(UA.androidChrome, 5)).toBe(false);
    expect(isInAppBrowser(UA.macSafari, 0)).toBe(false);
  });
});

describe("installMethod", () => {
  const base = { standalone: false, promptReady: false, ios: false, inApp: false };

  it("браузер прислал beforeinstallprompt — кнопка", () => {
    expect(installMethod({ ...base, promptReady: true })).toBe("prompt");
  });

  it("iOS без события — подсказка про «Поделиться»", () => {
    expect(installMethod({ ...base, ios: true })).toBe("ios-hint");
  });

  it("встроенный браузер — «Откройте в Safari/Chrome»", () => {
    expect(installMethod({ ...base, inApp: true })).toBe("open-in-browser");
  });

  it("уже установлено — ничего, даже если событие есть", () => {
    expect(installMethod({ ...base, standalone: true, promptReady: true })).toBe("none");
    expect(installMethod({ ...base, standalone: true, ios: true })).toBe("none");
    expect(installMethod({ ...base, standalone: true, inApp: true })).toBe("none");
  });

  it("события нет и не iOS (Firefox на компьютере, уже установлено) — ничего", () => {
    expect(installMethod(base)).toBe("none");
  });
});

describe("showBanner", () => {
  it("плашка на главной — только когда установить можно и её не скрывали", () => {
    expect(showBanner("prompt", false)).toBe(true);
    expect(showBanner("ios-hint", false)).toBe(true);
    expect(showBanner("prompt", true)).toBe(false);
    expect(showBanner("open-in-browser", false)).toBe(true);
    expect(showBanner("none", false)).toBe(false);
  });
});

describe("showHeaderItem", () => {
  it("пункт в шапке есть, пока установить можно, и не зависит от «Скрыть» у плашки", () => {
    expect(showHeaderItem("prompt")).toBe(true);
    expect(showHeaderItem("ios-hint")).toBe(true);
    expect(showHeaderItem("open-in-browser")).toBe(true);
    expect(showHeaderItem("none")).toBe(false);
  });
});

describe("выбор «Скрыть» в localStorage", () => {
  const memory = () => {
    const data = new Map<string, string>();
    return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
  };

  it("сохраняется и читается", () => {
    const storage = memory();
    expect(readDismissed(() => storage)).toBe(false);
    saveDismissed(() => storage);
    expect(storage.getItem(DISMISS_KEY)).toBe("1");
    expect(readDismissed(() => storage)).toBe(true);
  });

  it("хранилище недоступно (приватный режим, запрет cookies) — не падает, плашка показывается", () => {
    const blocked = () => {
      throw new DOMException("denied", "SecurityError");
    };
    expect(readDismissed(blocked)).toBe(false);
    expect(() => saveDismissed(blocked)).not.toThrow();
    const full = { getItem: () => null, setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
    expect(() => saveDismissed(() => full)).not.toThrow();
  });
});
