import { create } from "@bufbuild/protobuf";
import { Code, ConnectError } from "@connectrpc/connect";
import { afterEach, describe, expect, it } from "vitest";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import { resetEnvCache } from "./env";
import { meshTransport, resetMeshTransport, rpcErrorCode } from "./rpc";

describe("rpcErrorCode", () => {
  it("достаёт код из ErrorDetail в ConnectError", () => {
    const detail = create(ErrorDetailSchema, { code: "deal_not_found" });
    const err = new ConnectError("не важно", Code.NotFound, undefined, [{ desc: ErrorDetailSchema, value: detail }]);
    expect(rpcErrorCode(err)).toBe("deal_not_found");
  });

  it("возвращает null для обычной ошибки и для ConnectError без детали", () => {
    expect(rpcErrorCode(new Error("boom"))).toBeNull();
    expect(rpcErrorCode(new ConnectError("x", Code.Internal))).toBeNull();
    expect(rpcErrorCode("строка")).toBeNull();
  });
});

describe("meshTransport", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    resetEnvCache();
    resetMeshTransport();
  });

  function setup(extra: Record<string, string>) {
    process.env = { ...saved, DATABASE_URL: "postgresql://x", V2_ENABLED: "true", ...extra };
    delete process.env.MESH_URL;
    Object.assign(process.env, extra);
    resetEnvCache();
    resetMeshTransport();
  }

  it("без MESH_URL при V2_ENABLED=true — ошибка конфигурации с именем переменной", () => {
    setup({});
    expect(() => meshTransport()).toThrow(/MESH_URL/);
  });

  it("при V2_ENABLED=false — ошибка о выключенном v2", () => {
    setup({ V2_ENABLED: "false" });
    expect(() => meshTransport()).toThrow(/V2_ENABLED/);
  });

  it("http-адрес без TLS-файлов собирается и переиспользуется (один на процесс)", () => {
    setup({ MESH_URL: "http://localhost:9" });
    expect(meshTransport()).toBe(meshTransport());
  });

  it("https-адрес без файлов сертификатов — ошибка с именем переменной", () => {
    setup({ MESH_URL: "https://mesh:9443" });
    expect(() => meshTransport()).toThrow(/MESH_TLS_CERT_FILE/);
  });
});
