import { railWebhook } from "../_handle";

/**
 * Вебхуки банка-партнёра. Разбор и проверка подписи — bankRail.parseWebhook; пока банк не подключён,
 * маршрут отвечает 503, и банк повторит доставку. Требования — docs/bank/03-escrow-integration.md.
 */
export async function POST(request: Request) {
  return railWebhook("bank", request);
}
