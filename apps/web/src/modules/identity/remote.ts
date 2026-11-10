import "server-only";
import { isIP } from "node:net";
import { createClient, type Client } from "@connectrpc/connect";
import { IdentityService } from "@/gen/senim/identity/v1/identity_pb";
import { meshTransport } from "@/platform/rpc";

/** Клиент сервиса identity (gRPC через mesh). */
export type IdentityClient = Client<typeof IdentityService>;

let real: IdentityClient | undefined;
let override: IdentityClient | null = null;

/** Клиент identity; транспорт (mTLS, дедлайн 5 с, traceparent) создаётся один раз на процесс. */
export function identity(): IdentityClient {
  if (override) return override;
  real ??= createClient(IdentityService, meshTransport());
  return real;
}

/** Только для тестов: подставить подделку (`null` — вернуть настоящий клиент). */
export function setIdentityForTests(client: IdentityClient | null): void {
  override = client;
}

/**
 * IP клиента для RequestOtp/VerifyOtp: identity принимает только одиночный адрес без порта и без списка,
 * иначе отвечает `invalid_request`. Не адрес — пустая строка («неизвестен», лимиты по IP не применяются).
 */
export function identityClientIp(ip: string | null): string {
  return ip !== null && isIP(ip) !== 0 ? ip : "";
}
