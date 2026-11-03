import { ru } from "@/i18n/ru";
import type { WebhookInput, WebhookResponse, WebhookResult } from "../../provider";
import { scriptNameOf, verifyFields, type Fields } from "./signature";
import { declinedText, formatRef, statusResult } from "./status";
import { fieldText, parseXmlFields } from "./xml";

/**
 * Уведомления Freedom Pay (Callbacks Overview, https://docs.freedompay.kz/overview-2504969m0.md):
 * - Result notify (https://docs.freedompay.kz/12007677e0): мы передаём `pg_request_method=POST` — поля
 *   приходят формой; режим XML (`pg_xml` с корнем `request`) тоже разбирается. Ключ — платёжный.
 * - Payout notify (https://docs.freedompay.kz/11622162e0): «always a POST with one field, `pg_xml`», корень
 *   `response`. Ключ — выплатный.
 * Имя скрипта подписи — последний сегмент пути нашего URL уведомления. Неизвестные поля участвуют в подписи
 * и не ломают разбор. Повтор того же уведомления даёт тот же externalEventId («process it by `pg_payment_id`
 * only once, and give the same answer»).
 *
 * Ответ на Result notify — только `ok`: `rejected` при `pg_can_reject=1` Freedom Pay понимает как возврат
 * денег клиенту. Подпись ответа документация не требует — ответ не подписан.
 */

export type WebhookConfig = {
  secretKey: string;
  payoutSecretKey: string | undefined;
  resultUrl: string;
  payoutNotifyUrl: string;
};

const XML_TYPE = "text/xml; charset=utf-8";
/** Пример ответа Result notify из документации (принять). */
const RESULT_OK: WebhookResponse = {
  status: 200,
  contentType: XML_TYPE,
  body: '<?xml version="1.0" encoding="utf-8"?>\n<response>\n    <pg_status>ok</pg_status>\n</response>',
};
/** Пример ответа Payout notify из документации. */
const PAYOUT_OK: WebhookResponse = { status: 200, contentType: XML_TYPE, body: '<?xml version="1.0" encoding="utf-8"?>\n<pg_status>ok</pg_status>' };

const rejected = (reason: string): WebhookResult => ({ kind: "rejected", reason });

const failureText = (fields: Fields) => declinedText(fieldText(fields, "pg_failure_code") ?? "", fieldText(fields, "pg_failure_description") ?? "");

/** Обязательные поля обоих уведомлений: pg_order_id, числовой pg_payment_id и поле итога. */
function requiredFields(fields: Fields, valueField: string) {
  const orderId = fieldText(fields, "pg_order_id");
  const paymentId = fieldText(fields, "pg_payment_id");
  const value = fieldText(fields, valueField);
  return orderId && paymentId && /^\d+$/.test(paymentId) && value ? { orderId, paymentId, value } : null;
}

function resultNotify(fields: Fields): WebhookResult {
  const required = requiredFields(fields, "pg_result");
  if (!required) return rejected("Result notify без pg_order_id, pg_payment_id или pg_result");
  const { orderId, paymentId, value: result } = required;
  const externalEventId = `freedompay:result:${paymentId}:${result}`;
  // Стенд работает только с тестовыми деньгами: живой платёж не подтверждаем, но и не отклоняем (это был бы возврат).
  if (fieldText(fields, "pg_testing_mode") !== "1") {
    return { kind: "ignored", externalEventId, reason: ru.payments.freedompay.notTestPayment, response: RESULT_OK };
  }
  // TODO(freedompay): сверку суммы и валюты с операцией журнала («check the order: pg_order_id, amount, and currency»)
  // делает вызывающий — WebhookResult не несёт сумму; уточнить при подключении к deal-core.
  const externalRef = formatRef({ kind: "payment", paymentId });
  if (result === "1") return { kind: "settled", externalEventId, idempotencyKey: orderId, result: { status: "SUCCEEDED", externalRef }, response: RESULT_OK };
  if (result === "0") return { kind: "settled", externalEventId, idempotencyKey: orderId, result: { status: "FAILED", error: failureText(fields) }, response: RESULT_OK };
  // pg_result=2 — «not completed (sent only if enabled for your merchant)»: итог придёт позже.
  return { kind: "ignored", externalEventId, reason: `pg_result=${result}: платёж не завершён`, response: RESULT_OK };
}

function payoutNotify(fields: Fields): WebhookResult {
  const required = requiredFields(fields, "pg_payment_status");
  if (!required) return rejected("Payout notify без pg_order_id, pg_payment_id или pg_payment_status");
  const { orderId, paymentId: payoutId, value: status } = required;
  const externalEventId = `freedompay:payout:${payoutId}:${status}`;
  const result = statusResult(status, fields, formatRef({ kind: "payout", payoutId }));
  if (result.status === "PENDING") return { kind: "ignored", externalEventId, reason: `выплата в статусе ${status}`, response: PAYOUT_OK };
  return { kind: "settled", externalEventId, idempotencyKey: orderId, result, response: PAYOUT_OK };
}

type Notification = { kind: "payout" | "result"; fields: Fields };

/** Тело уведомления: одно поле pg_xml (корень response — выплата, request — Result notify в режиме XML) или форма. */
function readNotification(body: string): Notification | string {
  const form: Fields = [...new URLSearchParams(body).entries()];
  if (form.length === 0) return "пустое уведомление";
  if (form.length !== 1 || form[0]![0] !== "pg_xml") return { kind: "result", fields: form };
  const xml = parseXmlFields(String(form[0]![1]));
  if (!xml) return "pg_xml не разобран";
  if (xml.root === "response") return { kind: "payout", fields: xml.fields };
  return xml.root === "request" ? { kind: "result", fields: xml.fields } : `неизвестный корень pg_xml: ${xml.root}`;
}

export async function handleFreedomPayWebhook(config: WebhookConfig, input: WebhookInput): Promise<WebhookResult> {
  const notification = readNotification(input.body);
  if (typeof notification === "string") return rejected(notification);
  const { kind, fields } = notification;
  const [url, key] = kind === "payout" ? [config.payoutNotifyUrl, config.payoutSecretKey] : [config.resultUrl, config.secretKey];
  if (!key) return rejected("Payout notify, а выплатный ключ не задан");
  if (!verifyFields(scriptNameOf(url), fields, key)) return rejected(`подпись ${kind === "payout" ? "Payout" : "Result"} notify неверна`);
  return kind === "payout" ? payoutNotify(fields) : resultNotify(fields);
}
