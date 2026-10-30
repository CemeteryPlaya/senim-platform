import { describe, expect, it } from "vitest";
import { clientIpFrom } from "./client-info";

const h = (init: Record<string, string>) => new Headers(init);

describe("clientIpFrom", () => {
  it("за доверенным прокси берёт первый адрес x-forwarded-for", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1", "x-real-ip": "10.0.0.1" }), true)).toBe("203.0.113.7");
  });

  it("без TRUST_PROXY x-forwarded-for не читает — его может подделать клиент", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4" }), false)).toBeNull();
    expect(clientIpFrom(h({ "x-forwarded-for": "1.2.3.4", "x-real-ip": "198.51.100.2" }), false)).toBe("198.51.100.2");
  });

  it("за прокси без x-forwarded-for — x-real-ip", () => {
    expect(clientIpFrom(h({ "x-real-ip": " 198.51.100.2 " }), true)).toBe("198.51.100.2");
  });

  it("адрес неизвестен — null, а не общий ключ «unknown»", () => {
    expect(clientIpFrom(h({}), true)).toBeNull();
    expect(clientIpFrom(h({ "x-forwarded-for": " , " }), true)).toBeNull();
  });
});
