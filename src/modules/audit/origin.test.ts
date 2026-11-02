import { afterEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ current: null as Headers | null }));
vi.mock("next/headers", () => ({
  headers: async () => {
    if (!requestHeaders.current) throw new Error("`headers` was called outside a request scope");
    return requestHeaders.current;
  },
}));

const { clientIpFrom, requestOrigin } = await import("./origin");
const { resetEnvCache } = await import("@/platform/env");

const h = (init: Record<string, string>) => new Headers(init);

afterEach(() => {
  requestHeaders.current = null;
  delete process.env.TRUST_PROXY;
  resetEnvCache();
});

describe("clientIpFrom", () => {
  it("без доверенного прокси заголовкам не верим", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" }), false)).toBeNull();
  });

  it("за прокси — правый адрес x-forwarded-for, затем x-real-ip", () => {
    expect(clientIpFrom(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.1 , 203.0.113.7" }), true)).toBe("203.0.113.7");
    expect(clientIpFrom(h({ "x-real-ip": " 198.51.100.2 " }), true)).toBe("198.51.100.2");
    expect(clientIpFrom(h({}), true)).toBeNull();
  });
});

describe("requestOrigin", () => {
  it("вне запроса — неизвестно, без ошибки", async () => {
    expect(await requestOrigin()).toEqual({ ip: null, userAgent: null });
  });

  it("в запросе — IP с учётом TRUST_PROXY и устройство", async () => {
    process.env.TRUST_PROXY = "true";
    resetEnvCache();
    requestHeaders.current = h({ "x-forwarded-for": "203.0.113.7", "user-agent": "Mozilla/5.0 (iPhone)" });
    expect(await requestOrigin()).toEqual({ ip: "203.0.113.7", userAgent: "Mozilla/5.0 (iPhone)" });
  });

  it("без TRUST_PROXY IP не берём, устройство — да; длинный User-Agent обрезан", async () => {
    requestHeaders.current = h({ "x-forwarded-for": "203.0.113.7", "user-agent": "x".repeat(900) });
    const origin = await requestOrigin();
    expect(origin.ip).toBeNull();
    expect(origin.userAgent).toHaveLength(500);
  });
});
