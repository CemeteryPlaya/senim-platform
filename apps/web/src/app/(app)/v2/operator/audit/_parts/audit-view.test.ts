import { describe, expect, it } from "vitest";
import { ru } from "@/i18n/ru";
import { deviceShort, originLine } from "./audit-view";

const t = ru.app.operatorDeals.audit;

const ANDROID_CHROME = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1";
const WINDOWS_EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0";
const MAC_YANDEX = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 YaBrowser/24.12.0.0 Safari/537.36";

describe("deviceShort: устройство коротко из user-agent", () => {
  it("система и браузер: Edge и Яндекс не путаются с Chrome, Chrome — с Safari, Android — с Linux", () => {
    expect(deviceShort(ANDROID_CHROME)).toBe("Android, Chrome");
    expect(deviceShort(IPHONE_SAFARI)).toBe("iPhone, Safari");
    expect(deviceShort(WINDOWS_EDGE)).toBe("Windows, Edge");
    expect(deviceShort(MAC_YANDEX)).toBe("macOS, Яндекс Браузер");
  });

  it("ничего не распознано — null", () => {
    expect(deviceShort("curl/8.4.0")).toBeNull();
  });
});

describe("originLine: откуда — коротко, полный user-agent по нажатию", () => {
  it("IP и устройство одной строкой; полная строка — отдельно, не теряется (ТЗ п. 11)", () => {
    expect(originLine({ ip: "10.0.0.7", userAgent: ANDROID_CHROME, actorRole: "CLIENT" })).toEqual({
      short: `${t.ip("10.0.0.7")} · Android, Chrome`,
      full: t.device(ANDROID_CHROME),
    });
  });

  it("устройство не распознано — слово «устройство», полная строка по нажатию; только IP — без полной строки", () => {
    expect(originLine({ ip: null, userAgent: "curl/8.4.0", actorRole: "CLIENT" })).toEqual({ short: t.deviceUnknown, full: t.device("curl/8.4.0") });
    expect(originLine({ ip: "10.0.0.7", userAgent: null, actorRole: "OPERATOR" })).toEqual({ short: t.ip("10.0.0.7"), full: null });
  });

  it("системное действие без IP и устройства — строки нет; у человека — «не записаны»", () => {
    expect(originLine({ ip: null, userAgent: null, actorRole: "SYSTEM" })).toBeNull();
    expect(originLine({ ip: null, userAgent: null, actorRole: "CLIENT" })).toEqual({ short: t.noOrigin, full: null });
  });
});
