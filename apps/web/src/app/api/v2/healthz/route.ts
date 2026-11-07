import { createClient } from "@connectrpc/connect";
import { Health, HealthCheckResponse_ServingStatus } from "@/gen/grpc/health/v1/health_pb";
import { env } from "@/platform/env";
import { logger } from "@/platform/logger";
import { meshTransport, rpcErrorCode, rpcStatusName } from "@/platform/rpc";

export const dynamic = "force-dynamic";

const SERVICE = "senim.identity.v1.IdentityService";

/** Проверка пути web → mesh → identity. Отвечает кодами, текст ошибки наружу не отдаёт. */
export async function GET() {
  if (!env().V2_ENABLED) return new Response(null, { status: 404 });
  try {
    // Health-пути не содержат имени сервиса — mesh маршрутизирует их по заголовку x-senim-target.
    const client = createClient(Health, meshTransport());
    let instance = "";
    const res = await client.check(
      { service: SERVICE },
      { headers: { "x-senim-target": "identity" }, onHeader: (h) => void (instance = h.get("x-senim-instance") ?? "") },
    );
    return Response.json({ identity: HealthCheckResponse_ServingStatus[res.status], instance });
  } catch (err) {
    const code = rpcErrorCode(err) ?? rpcStatusName(err);
    logger.warn("v2 healthz: identity недоступен", { code });
    return Response.json({ error: code }, { status: 503 });
  }
}
