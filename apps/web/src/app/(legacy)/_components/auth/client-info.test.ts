import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-info";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("за доверенным прокси берёт правый адрес x-forwarded-for — его добавил прокси, левые присылает клиент", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.7", "x-real-ip": "10.0.0.1" }), true)).toBe("203.0.113.7");
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.7" }), true)).toBe("203.0.113.7");
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4, 203.0.113.7 , " }), true)).toBe("203.0.113.7");
  });

  it("без TRUST_PROXY не читает ни x-forwarded-for, ни x-real-ip — оба может подделать клиент", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4" }), false)).toBeNull();
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.2" }), false)).toBeNull();
    expect(clientIpFrom(h({ "x-real-ip": "198.51.100.2" }), false)).toBeNull();
  });

  it("за прокси без x-forwarded-for — x-real-ip", () => {
    expect(clientIpFrom(h({ "x-real-ip": " 198.51.100.2 " }), true)).toBe("198.51.100.2");
  });

  it("адрес неизвестен — null, а не общий ключ «unknown»", () => {
    expect(clientIpFrom(h({}), true)).toBeNull();
    expect(clientIpFrom(h({ "x-forwarded-for": " , " }), true)).toBeNull();
  });
});
