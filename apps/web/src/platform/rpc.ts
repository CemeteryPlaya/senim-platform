import "server-only";
import { readFileSync } from "node:fs";
import { Code, ConnectError, type Interceptor, type Transport } from "@connectrpc/connect";
import { createGrpcTransport } from "@connectrpc/connect-node";
import { ErrorDetailSchema } from "@/gen/senim/common/v1/error_pb";
import { env } from "./env";

/** Дедлайн по умолчанию для любого вызова в v2 (global-constraints): ни одного вызова без дедлайна. */
export const DEFAULT_DEADLINE_MS = 5_000;

/**
 * Пробрасывает входящий `traceparent` запроса в Next (route handler / server action), если он есть.
 * @opentelemetry/api в приложении нет — своего контекста трассировки не создаём. Вне запроса ничего не добавляет.
 */
const traceparent: Interceptor = (next) => async (req) => {
  try {
    const { headers } = await import("next/headers");
    const value = (await headers()).get("traceparent");
    if (value && !req.header.has("traceparent")) req.header.set("traceparent", value);
  } catch {
    // Вызов вне запроса (джоба, тест): заголовка нет — это нормально.
  }
  return next(req);
};

let transport: Transport | undefined;

function readFile(name: string, path: string | undefined): Buffer {
  if (!path) throw new Error(`Не задана переменная ${name}: нужна для mTLS к mesh`);
  return readFileSync(path);
}

/** Транспорт gRPC к mesh (Envoy) с mTLS; создаётся один раз на процесс, файлы сертификатов читаются один раз. */
export function meshTransport(): Transport {
  if (transport) return transport;
  const e = env();
  if (!e.V2_ENABLED) throw new Error("Платформа v2 выключена: V2_ENABLED не равна true");
  if (!e.MESH_URL) throw new Error("Не задана переменная MESH_URL: адрес mesh для gRPC");
  const https = e.MESH_URL.startsWith("https://");
  // Defence in depth: вне dev открытый текст к mesh недопустим, даже если env-проверка обойдена.
  if (e.APP_ENV !== "dev" && !https) throw new Error(`MESH_URL должен начинаться с https:// при APP_ENV=${e.APP_ENV}`);
  const tls = https
    ? {
        cert: readFile("MESH_TLS_CERT_FILE", e.MESH_TLS_CERT_FILE),
        key: readFile("MESH_TLS_KEY_FILE", e.MESH_TLS_KEY_FILE),
        ca: readFile("MESH_TLS_CA_FILE", e.MESH_TLS_CA_FILE),
      }
    : undefined;
  transport = createGrpcTransport({
    baseUrl: e.MESH_URL,
    defaultTimeoutMs: DEFAULT_DEADLINE_MS,
    interceptors: [traceparent],
    nodeOptions: tls,
  });
  return transport;
}

/** Только для тестов: пересоздать транспорт после смены окружения. */
export function resetMeshTransport() {
  transport = undefined;
}

/** Машинный код причины (`ErrorDetail.code`) из ошибки вызова; `null`, если это не ConnectError с такой деталью. */
export function rpcErrorCode(err: unknown): string | null {
  if (!(err instanceof ConnectError)) return null;
  return err.findDetails(ErrorDetailSchema)[0]?.code ?? null;
}

/** Код gRPC в нижнем регистре (`unavailable`, `deadline_exceeded`) для ответов, где нет ErrorDetail. */
export function rpcStatusName(err: unknown): string {
  const code = ConnectError.from(err).code;
  return (Code[code] ?? "unknown").replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}
