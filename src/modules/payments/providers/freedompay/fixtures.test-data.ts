/**
 * Ответы и уведомления из примеров документации docs.freedompay.kz (только для тестов).
 * Подписи ответов в примерах сделаны не ключом `test_secret_key` (сверка не сходится) —
 * поэтому тесты провайдера переподписывают те же поля своим тестовым ключом.
 */

/** https://docs.freedompay.kz/create-payment-11620859e0 — успешный ответ init_payment: набор полей по документации, значения условные. */
export const INIT_PAYMENT_OK = `<?xml version="1.0" encoding="utf-8"?>
<response>
    <pg_status>ok</pg_status>
    <pg_payment_id>1022123804618</pg_payment_id>
    <pg_redirect_url>https://customer.freedompay.kz/pay.html?customer=abc&amp;lang=ru</pg_redirect_url>
    <pg_redirect_url_type>need data</pg_redirect_url_type>
    <pg_salt>p1BfAS3TlDlBtg7z</pg_salt>
    <pg_sig>00000000000000000000000000000000</pg_sig>
</response>`;

/** Там же — ошибка 1100 без подписи («error responses are not signed»); текст ошибки условный. */
export const ERROR_UNSIGNED = `<?xml version="1.0" encoding="utf-8"?>
<response>
    <pg_status>error</pg_status>
    <pg_error_code>1100</pg_error_code>
    <pg_error_description>Некорректная подпись запроса</pg_error_description>
</response>`;

/** https://docs.freedompay.kz/11620963e0 — «Платёж не найден». */
export const STATUS_NOT_FOUND = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <pg_status>error</pg_status>
    <pg_error_code>11068</pg_error_code>
    <pg_error_description>Платёж не найден.</pg_error_description>
</response>`;

/** https://docs.freedompay.kz/12100676e0 — статус выплаты, дословно. */
export const PAYOUT_STATUS_OK = `<?xml version="1.0" encoding="UTF-8"?>
<response>
    <pg_merchant_id>13991</pg_merchant_id>
    <pg_payment_id>4102</pg_payment_id>
    <pg_status>ok</pg_status>
    <pg_payment_status>success</pg_payment_status>
    <pg_order_id>mp-dup-45684a</pg_order_id>
    <pg_amount>100</pg_amount>
    <pg_net_amount>75</pg_net_amount>
    <pg_currency>KZT</pg_currency>
    <pg_card_name>IVAN IVANOV</pg_card_name>
    <pg_salt>yG4WsRu3biAWzIGr</pg_salt>
    <pg_sig>444ce9646cc78dc68ad55721f9ccd477</pg_sig>
</response>`;

/** https://docs.freedompay.kz/11622162e0 — Payout notify, значение поля pg_xml (сокращено в документации). */
export const PAYOUT_NOTIFY_XML = `<?xml version="1.0" encoding="utf-8"?>
<response>
    <pg_status>ok</pg_status>
    <pg_payment_status>success</pg_payment_status>
    <pg_payment_id>4102</pg_payment_id>
    <pg_order_id>mp-dup-45684a</pg_order_id>
    <pg_payment_amount>100</pg_payment_amount>
    <pg_to_pay>100</pg_to_pay>
    <pg_merchant_id>13991</pg_merchant_id>
    <pg_payment_date>2026-10-25 22:41:45</pg_payment_date>
    <pg_salt>ajdeWVuOaTfKygtW</pg_salt>
    <pg_sig>558577fd22bb9fdc6de7ccc8b605315f</pg_sig>
</response>`;

/** https://docs.freedompay.kz/12007677e0 — Result notify, успешный платёж (поля в порядке документации). */
export const RESULT_OK: ReadonlyArray<readonly [string, string]> = [
  ["pg_order_id", "order-1001"],
  ["pg_payment_id", "1022123804618"],
  ["pg_amount", "1000"],
  ["pg_currency", "KZT"],
  ["pg_net_amount", "970"],
  ["pg_ps_amount", "1000"],
  ["pg_ps_full_amount", "1000"],
  ["pg_ps_currency", "KZT"],
  ["pg_description", "Order 1001"],
  ["pg_result", "1"],
  ["pg_payment_date", "2026-11-01 12:30:15"],
  ["pg_can_reject", "1"],
  ["pg_user_phone", "77001234567"],
  ["pg_need_phone_notification", "0"],
  ["pg_user_contact_email", "client@example.com"],
  ["pg_need_email_notification", "0"],
  ["pg_payment_method", "bankcard"],
  ["pg_reference", "430512345678"],
  ["pg_user_ip", "192.0.2.10"],
  ["pg_captured", "1"],
  ["pg_card_pan", "4400-44XX-XXXX-4440"],
  ["pg_card_exp", "12/27"],
  ["pg_card_owner", "IVAN IVANOV"],
  ["pg_card_brand", "VI"],
  ["pg_auth_code", "123456"],
  ["pg_salt", "bR5xQ2mL8nT4vW1z"],
];

/** https://docs.freedompay.kz/12007677e0 — Result notify, неуспешный платёж. */
export const RESULT_FAILED: ReadonlyArray<readonly [string, string]> = [
  ["pg_order_id", "order-1002"],
  ["pg_payment_id", "1022123804619"],
  ["pg_amount", "1000"],
  ["pg_currency", "KZT"],
  ["pg_result", "0"],
  ["pg_can_reject", "0"],
  ["pg_payment_method", "bankcard"],
  ["pg_captured", "0"],
  ["pg_failure_code", "99999"],
  ["pg_failure_description", "Неизвестная ошибка платежной системы"],
  ["pg_salt", "Kp3sW9dQ1xZ7mN2c"],
];
