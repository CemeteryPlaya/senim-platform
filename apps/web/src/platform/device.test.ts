import { describe, expect, it } from "vitest";
import { deviceFromHeaders } from "./device";

const UA = {
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  androidTablet:
    "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  pixelChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  ipadSafari:
    "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  // iPadOS 13+ по умолчанию представляется как Mac. Строка намеренно совпадает с macSafari: по заголовкам их не различить.
  ipadAsMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  curl: "curl/8.5.0",
  // Chrome на Android в режиме «Версия для ПК»: UA как у Linux-компьютера, hint ?0.
  androidDesktopSite:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
} as const;

function from(headers: Record<string, string>) {
  return deviceFromHeaders((name) => headers[name] ?? null);
}

describe("deviceFromHeaders", () => {
  it("client hint ?1 даёт телефонную версию", () => {
    expect(from({ "sec-ch-ua-mobile": "?1" })).toBe("mobile");
  });

  it("client hint ?0 и Windows Chrome дают компьютерную версию", () => {
    expect(from({ "sec-ch-ua-mobile": "?0", "user-agent": UA.windowsChrome })).toBe("desktop");
  });

  it("планшет Android без слова Mobile при hint ?0 получает телефонную версию", () => {
    expect(from({ "sec-ch-ua-mobile": "?0", "user-agent": UA.androidTablet })).toBe("mobile");
  });

  it("iPhone Safari без client hints получает телефонную версию", () => {
    expect(from({ "user-agent": UA.iphoneSafari })).toBe("mobile");
  });

  it("Pixel 7 Chrome получает телефонную версию", () => {
    expect(from({ "user-agent": UA.pixelChrome })).toBe("mobile");
  });

  it("iPad с iPadOS 17 получает телефонную версию", () => {
    expect(from({ "user-agent": UA.ipadSafari })).toBe("mobile");
  });

  it("iPadOS Safari в режиме «как Mac» получает компьютерную версию (известное ограничение)", () => {
    // Известное ограничение, принятое владельцем продукта: по заголовкам такой iPad
    // неотличим от Mac, поэтому получает компьютерную версию.
    expect(from({ "user-agent": UA.ipadAsMac })).toBe("desktop");
  });

  it("macOS Safari получает компьютерную версию", () => {
    expect(from({ "user-agent": UA.macSafari })).toBe("desktop");
  });

  it("без заголовков получает компьютерную версию", () => {
    expect(from({})).toBe("desktop");
  });

  it("curl получает компьютерную версию", () => {
    expect(from({ "user-agent": UA.curl })).toBe("desktop");
  });

  describe("пересечения правил", () => {
    it("hint ?1 важнее User-Agent компьютера", () => {
      expect(from({ "sec-ch-ua-mobile": "?1", "user-agent": UA.windowsChrome })).toBe("mobile");
    });

    it("мусор в hint не решает: решает User-Agent", () => {
      expect(from({ "sec-ch-ua-mobile": "yes", "user-agent": UA.windowsChrome })).toBe("desktop");
      expect(from({ "sec-ch-ua-mobile": "1", "user-agent": UA.pixelChrome })).toBe("mobile");
      expect(from({ "sec-ch-ua-mobile": "", "user-agent": UA.iphoneSafari })).toBe("mobile");
    });

    it("Android Chrome в режиме «Версия для ПК» (?0 и UA Linux) получает компьютерную версию", () => {
      expect(from({ "sec-ch-ua-mobile": "?0", "user-agent": UA.androidDesktopSite })).toBe("desktop");
    });

    it("пустой User-Agent получает компьютерную версию", () => {
      expect(from({ "user-agent": "" })).toBe("desktop");
    });
  });
});
