import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/platform/env";

const check = vi.fn();
vi.mock("@connectrpc/connect", async (orig) => ({ ...(await orig<typeof import("@connectrpc/connect")>()), createClient: () => ({ check }) }));
vi.mock("@/platform/rpc", async (orig) => ({ ...(await orig<typeof import("@/platform/rpc")>()), meshTransport: () => ({}) }));

import { GET } from "./route";

describe("GET /api/v2/healthz", () => {
  const saved = { ...process.env };
  const set = (extra: Record<string, string>) => {
    process.env = { ...saved, DATABASE_URL: "postgresql://x", ...extra };
    resetEnvCache();
  };
  beforeEach(() => {
    check.mockReset();
  });
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
  });

  it("404 и no-store, когда V2_ENABLED выключен", async () => {
    set({ V2_ENABLED: "false" });
    const res = await GET();
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("200 SERVING с no-store; instance — только в dev", async () => {
    set({ V2_ENABLED: "true", APP_ENV: "dev" });
    check.mockImplementation(async (...args: unknown[]) => {
      const opts = args[1] as { onHeader: (h: Headers) => void };
      opts.onHeader(new Headers({ "x-senim-instance": "identity-1" }));
      return { status: 1 };
    });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ identity: "SERVING", instance: "identity-1" });
    expect(check.mock.calls[0]?.[0]).toEqual({ service: "senim.identity.v1.IdentityService" });
    expect(check.mock.calls[0]?.[1].headers).toEqual({ "x-senim-target": "identity" });
  });

  it("вне dev instance не отдаётся", async () => {
    set({ V2_ENABLED: "true", APP_ENV: "staging", PAYMENT_PROVIDER: "mock", MESH_URL: "https://m", MESH_TLS_CERT_FILE: "/c", MESH_TLS_KEY_FILE: "/k", MESH_TLS_CA_FILE: "/ca" });
    check.mockResolvedValue({ status: 1 });
    expect(await (await GET()).json()).toEqual({ identity: "SERVING" });
  });

  it("503, когда identity отвечает не SERVING (healthcheck контейнера смотрит на r.ok)", async () => {
    set({ V2_ENABLED: "true", APP_ENV: "dev" });
    for (const status of [0, 2, 3]) {
      check.mockResolvedValueOnce({ status });
      const res = await GET();
      expect(res.status).toBe(503);
      expect(res.headers.get("cache-control")).toBe("no-store");
      expect((await res.json()).identity).not.toBe("SERVING");
    }
  });

  it("503 только с кодом, без текста ошибки, с no-store", async () => {
    set({ V2_ENABLED: "true", APP_ENV: "dev" });
    check.mockRejectedValue(new ConnectError("секретный текст host=10.0.0.1", Code.Unavailable));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: "unavailable" });
    expect(text).not.toContain("секретный");
  });
});
