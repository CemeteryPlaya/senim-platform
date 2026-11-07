import type { z } from "zod";
import { ru } from "@/i18n/ru";
import { requireUser } from "@/modules/identity";
import { pushEndpointSchema, pushSubscriptionSchema, subscribePush, unsubscribePush } from "@/modules/notifications";
import { fail } from "@/platform/errors";
import { errorResponse, readTextLimited } from "@/platform/http";
import { enforceRateLimit } from "@/platform/rate-limit";
import { parseInput } from "@/platform/validation";

/** Подписка — несколько сотен байт; больше — не подписка. */
const MAX_BODY_BYTES = 4 * 1024;
/** Подписка меняется при входе и при обновлении ключей браузером — 30 раз в час с запасом. */
const RATE = { limit: 30, windowSec: 3600 };

/**
 * Тело — только JSON: такой запрос с чужого сайта браузер не отправит без предварительной проверки
 * CORS, поэтому чужая страница не подпишет и не отпишет устройство от имени вошедшего (CSRF).
 */
async function readJson<S extends z.ZodType>(request: Request, schema: S): Promise<z.infer<S>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return fail.validation(ru.notifications.push.errors.badSubscription);
  const text = await readTextLimited(request, MAX_BODY_BYTES);
  if (text === null) return fail.validation(ru.notifications.push.errors.badSubscription);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return fail.validation(ru.notifications.push.errors.badSubscription);
  }
  return parseInput(schema, body);
}

/** Включить push на этом устройстве: тело — PushSubscription.toJSON() браузера. */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`push.subscribe:${user.id}`, RATE);
    const subscription = await readJson(request, pushSubscriptionSchema);
    await subscribePush(user, { ...subscription, userAgent: request.headers.get("user-agent") });
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e, "push.subscribe");
  }
}

/** Выключить push на этом устройстве: тело — { endpoint }. Только своя подписка. */
export async function DELETE(request: Request) {
  try {
    const user = await requireUser();
    await enforceRateLimit(`push.subscribe:${user.id}`, RATE);
    const { endpoint } = await readJson(request, pushEndpointSchema);
    await unsubscribePush(user, endpoint);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errorResponse(e, "push.unsubscribe");
  }
}
