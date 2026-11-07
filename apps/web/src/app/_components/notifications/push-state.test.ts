import { describe, expect, it } from "vitest";
import { isAppleMobile } from "../install/install-offer";
import { applicationServerKey, pushState } from "./push-state";

const desktop = { appleMobile: false, standalone: false, pushApi: true, permission: "default", subscribed: false } as const;

describe("pushState", () => {
  it("iPhone в Safari (не установлено) — подсказка про экран «Домой», даже без Push API", () => {
    expect(pushState({ ...desktop, appleMobile: true, pushApi: false })).toBe("ios-install");
  });

  it("iPhone в установленном приложении — обычная кнопка", () => {
    expect(pushState({ ...desktop, appleMobile: true, standalone: true })).toBe("off");
    expect(pushState({ ...desktop, appleMobile: true, standalone: true, permission: "granted", subscribed: true })).toBe("on");
  });

  it("нет Push API — не поддерживается; запрет в браузере — подсказка про настройки", () => {
    expect(pushState({ ...desktop, pushApi: false })).toBe("unsupported");
    expect(pushState({ ...desktop, permission: "denied", subscribed: true })).toBe("denied");
  });

  it("подписка без разрешения (разрешение отозвали) считается выключенной", () => {
    expect(pushState({ ...desktop, subscribed: true })).toBe("off");
    expect(pushState({ ...desktop, subscribed: true, permission: "granted" })).toBe("on");
  });

  it("iPad с iPadOS (представляется как Mac) — тоже Apple; Mac без сенсора — нет", () => {
    const ipad = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(isAppleMobile(ipad, 5)).toBe(true);
    expect(isAppleMobile(ipad, 0)).toBe(false);
    expect(isAppleMobile("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Instagram", 5)).toBe(true);
  });
});

describe("applicationServerKey", () => {
  it("раскодирует base64url без выравнивания", () => {
    expect([...applicationServerKey("AQID_-8")]).toEqual([1, 2, 3, 255, 239]);
  });
});
