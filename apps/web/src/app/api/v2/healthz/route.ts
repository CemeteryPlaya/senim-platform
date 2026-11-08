import { createClient } from "@connectrpc/connect";
import { Health, HealthCheckResponse_ServingStatus } from "@/gen/grpc/health/v1/health_pb";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";
import { meshTransport, rpcErrorCode, rpcStatusName } from "@/platform/rpc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store" };

const SERVICE = "senim.identity.v1.IdentityService";

/** Проверка пути web → mesh → identity: 200 только при SERVING, иначе 503. Отвечает кодами, текст ошибки наружу не отдаёт. */
export async function GET() {
  if (!env().V2_ENABLED) return new Response(null, { status: 404, headers: HEADERS });
  try {
    // Health-пути не содержат имени сервиса — mesh маршрутизирует их по заголовку x-senim-target.
    const client = createClient(Health, meshTransport());
    let instance = "";
    const res = await client.check(
      { service: SERVICE },
      { headers: { "x-senim-target": "identity" }, onHeader: (h) => void (instance = h.get("x-senim-instance") ?? "") },
    );
    // Имя инстанса — внутренняя топология; публичный маршрут отдаёт его только в dev.
    const body: { identity: string; instance?: string } = { identity: HealthCheckResponse_ServingStatus[res.status] };
    if (env().APP_ENV === "dev") body.instance = instance;
    // Healthcheck контейнера и балансировщики смотрят на код ответа: здоров только SERVING.
    if (res.status !== HealthCheckResponse_ServingStatus.SERVING) {
      logger.warn("v2 healthz: identity не готов", { status: body.identity });
      return Response.json(body, { status: 503, headers: HEADERS });
    }
    return Response.json(body, { headers: HEADERS });
  } catch (err) {
    const code = rpcErrorCode(err) ?? rpcStatusName(err);
    logger.warn("v2 healthz: identity недоступен", { code });
    return Response.json({ error: code }, { status: 503, headers: HEADERS });
  }
}
