import { railWebhook } from "../_handle";

/** Вебхуки банк-симулятора (подпись HMAC-SHA256, заголовки x-senim-timestamp / x-senim-signature). */
export async function POST(request: Request) {
  return railWebhook("escrow-simulator", request);
}
