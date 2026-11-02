# 07. Freedom Pay: адаптер песочницы

Документ описывает адаптер платёжного провайдера Freedom Pay (`src/modules/payments/providers/freedompay/`), на чём он основан и где его границы. Адаптер работает **только в контуре `staging`** и **только с тестовыми платежами** (ADR-009, раздел 5; `OPEN_QUESTIONS.md` №41). В `prod` он запрещён: фабрика бросает ошибку при `appEnv ≠ staging`, и `env.ts` отвергает `PAYMENT_PROVIDER=freedompay` вне staging.

Всё ниже взято из публичной документации https://docs.freedompay.kz (прочитана 3 ноября 2026 г.). Чего в ней нет, мы не придумываем: такие места помечены **«не подтверждено документацией»**, а в коде — `TODO(freedompay)`.

> Как получены цитаты. Страницы читались инструментом, который пересказывает страницу и цитирует короткие фрагменты (английская версия документации). Поэтому формулировку каждой цитаты стоит сверить со страницей по ссылке. Алгоритм подписи от формулировок не зависит: все 8 примеров запросов из документации (`pg_sig`) воспроизводятся нашим кодом символ в символ (`signature.test.ts`).

## 1. Что реализовано

| Операция `PaymentProvider` | Метод Freedom Pay | Документация | Итог |
|---|---|---|---|
| `hold` | `POST /init_payment.php` | https://docs.freedompay.kz/create-payment-11620859e0 | `PENDING` + `redirectUrl` на страницу оплаты Freedom Pay. Карта вводится там, через наш сервер не проходит |
| `release` | `POST /get_status3.php` → `POST /do_capture.php` | https://docs.freedompay.kz/11620963e0, https://docs.freedompay.kz/11621002e0 | Клиринг (списание) заблокированной суммы. Если сумма уже списана (одностадийная оплата или повтор), второго клиринга нет |
| `split`, доля мастера | `POST /api/reg2nonreg` | https://docs.freedompay.kz/create-payment-11621022e0 | `PENDING` + `redirectUrl` на страницу выплаты: мастер сам вводит там карту. Подпись выплатным ключом |
| `split`, доля платформы | — | — | Перевода нет: доход уже входит в списанную сумму на балансе мерчанта (см. §6б). Ссылка `retained:<ключ>` |
| `refund` | `POST /cancel` или `POST /revoke` | https://docs.freedompay.kz/11621007e0, https://docs.freedompay.kz/11621013e0 | Несписанную оплату разблокирует `cancel` (только всю сумму), списанную возвращает `revoke` (можно частично) |
| `getStatus` | `get_status3.php` / `api/payment_status2` | https://docs.freedompay.kz/11620963e0, https://docs.freedompay.kz/12100676e0 | По `externalRef`. Если ответ на создание потерян, поиск по `pg_order_id` |
| `handleWebhook` | Result notify, Payout notify | https://docs.freedompay.kz/12007677e0, https://docs.freedompay.kz/11622162e0 | Проверка подписи; подделка — `rejected`; ответ в формате Freedom Pay |

Идемпотентность. Ключ операции журнала (`hold:<dealId>`, `split-master:<dealId>`…) передаётся как `pg_order_id` и как `pg_idempotency_key`. Про `pg_idempotency_key` документация пишет, что повтор запроса с тем же ключом «returns the existing payment» (init_payment) и «returns the existing payout» (reg2nonreg). `pg_order_id` ограничен 50 символами: если ключ длиннее, операция сразу получает `FAILED`, запрос не отправляется.

`externalRef` хранит вид операции, поэтому `getStatus` знает, какой метод спрашивать: `payment:<id>`, `capture:<id>`, `cancel:<платёж>:<отмена>`, `refund:<платёж>:<возврат>`, `payout:<id>`, `retained:<ключ>`, `released:<id>`.

Исходы вызова. Если Freedom Pay отказал (`pg_status=error`), операция получает `FAILED` с кодом и текстом ошибки. Если исход неизвестен (сеть, таймаут, ответ не XML, подпись ответа не сошлась), операция остаётся `PENDING`: итог уточнит `getStatus`, а повтор с тем же ключом безопасен. Повторы в клиенте есть только у запросов статуса: до 2 повторов с паузой 0,5 и 1 с.

## 2. Подпись `pg_sig`

Источник — раздел «Signature» в Merchant API Overview: https://docs.freedompay.kz/overview-741636m0.md

Алгоритм:
1. Первый элемент строки — **имя скрипта**: «the last segment of the URL path, exactly as in the request URL». У `…/init_payment.php` это `init_payment.php`, у `…/api/reg2nonreg` — `reg2nonreg`, у нашего URL уведомлений `…/freedompay/result` — `result`.
2. Затем **значения всех параметров**, кроме `pg_sig`, по алфавиту имён: «sorted by parameter name in alphabetical order». В подписи участвуют `pg_salt` и параметры без префикса `pg_`.
3. Вложенные массивы (например, `pg_receipt_positions`) сплющиваются так, как это делает код примеров документации на PHP и Python. Имя элемента = имя родителя + ключ + трёхзначный номер позиции на своём уровне. Номера начинаются с 1, и `pg_sig` тоже занимает позицию. Сортируются уже сплющенные имена. Мы повторяем именно код, потому что он и проза документации расходятся в краевых случаях (`a` и `a-b`).
4. В конце строки — **секретный ключ**. Для приёма платежей это платёжный ключ. Выплатный ключ нужен для `reg2nonreg`, `reg2reg`, `to_iban`, `payment_status2`, `balance_status`.
5. Все элементы склеиваются через `;`, от строки берётся **MD5**, результат — «32 lowercase hexadecimal characters».

Пример из документации (воспроизводится в `signature.test.ts`):
```
init_payment.php;100;KZT;Order #1001;12345;order_1001;a1b2c3d4;test_secret_key
→ b9ad75871668ca040f80f5f6b530e6ed
```

Ответы и уведомления:
- Подпись ответа: «calculated by the same rules with the same script name and key: take all fields of `<response>` except `pg_sig`».
- «Treat a response without `pg_sig` as an error». Поэтому неподписанный `ok` для нас — неизвестный исход, а не подтверждение. Ошибки (`pg_status=error`, коды 1100, 94031, 11005…) документация не подписывает («error responses are not signed»). Для нас это отказ.
- Подпись входящего уведомления сравнивается за постоянное время (`timingSafeEqual`).
- Значения передаём строками. Документация предупреждает, что в JSON «A JSON number is converted before the signature check (`100.50` becomes `100.5`)». Мы шлём форму `application/x-www-form-urlencoded`, а суммы пишем без хвостовых нулей: `100`, `100.5`.

**Не подтверждено документацией.** Подписи в примерах *ответов* (cancel, do_capture, revoke, reg2nonreg, Result notify, Payout notify) нашим кодом с ключом `test_secret_key` не воспроизводятся. Скорее всего, примеры сняты с другого мерчанта и другого ключа. Правило подписи ответа взято из текста; проверить его можно только на первом ответе песочницы. Если ответ содержит вложенные списки (`pg_refund_payments` в `get_status3.php`), как их сплющивать для подписи, документация не описывает. Мы применяем то же правило, что для запросов.

## 3. Поля запросов (что мы отправляем)

Общие для всех запросов: `pg_merchant_id`, `pg_salt` (случайные hex-символы), `pg_sig`. Формат — `POST application/x-www-form-urlencoded`, ответ — XML с корнем `<response>`.

**init_payment.php** (hold):

| Поле | Значение |
|---|---|
| `pg_order_id`, `pg_idempotency_key` | ключ операции журнала |
| `pg_amount` | сумма из тиынов (`bigint`), точка, до 2 знаков, без float: 1 234 567,89 ₸ → `1234567.89`; диапазон 0.01…99999999 |
| `pg_currency` | `KZT` |
| `pg_description` | назначение без персональных данных («Сделка №17») |
| `pg_result_url` | наш приём Result notify |
| `pg_request_method` | `POST`: уведомление придёт формой |
| `pg_success_url`, `pg_failure_url` | `returnUrl` запроса |
| `pg_auto_clearing` | `0` (двухстадийная, по умолчанию) или `1` |
| `pg_lifetime` | 86400 с (по умолчанию; допустимо 60…604800) |
| `pg_language` | `ru` |
| `pg_testing_mode` | `1`: тестовый платёж. По документации «Requests in test mode go to the same host and are signed the same way» |

Ответ: `pg_status=ok`, `pg_payment_id`, `pg_redirect_url`, `pg_redirect_url_type`, `pg_salt`, `pg_sig`.

**do_capture.php** (release): `pg_payment_id`, `pg_clearing_amount`. Документация: «A repeated request does not capture the amount again»; если в ответе `pg_clearing_amount = 0`, «nothing was captured» — для нас это `FAILED`.

**reg2nonreg** (выплата мастеру): `pg_order_id`, `pg_idempotency_key`, `pg_amount`, `pg_description` («Выплата по сделке»), `pg_order_time_limit` (через 72 ч, формат `YYYY-MM-DD hh:mm:ss`, «merchant time zone» — по умолчанию у нас `Asia/Almaty`), `pg_post_link`, `pg_back_link`. Подпись выплатным ключом. IBAN и имя мастера в этот запрос не уходят.

**cancel** / **revoke** (refund): `pg_payment_id`, `pg_idempotency_key`; у `revoke` ещё `pg_refund_amount`. Код `91021` («refund already in progress») означает, что возврат уже идёт: для нас это `PENDING`.

**get_status3.php** / **api/payment_status2**: передаём `pg_payment_id` или `pg_order_id`, одно из двух.

## 4. Уведомления

Общие правила взяты из Callbacks Overview (https://docs.freedompay.kz/overview-2504969m0.md):
- «Freedom Pay waits for the answer for 30 seconds».
- Имя скрипта подписи — последний сегмент пути **нашего** URL уведомления. Поэтому у URL уведомлений не может быть query: «Take all the fields that you received, except `pg_sig`, including your own parameters» и параметры query, а `WebhookInput` приходит без URL. Фабрика проверяет это при создании.
- «Callbacks may get new fields: do not reject a callback because of a field that you do not know». Неизвестные поля участвуют в подписи и разбор не ломают.
- «The same callback can come more than once: process it by `pg_payment_id` only once, and give the same answer». Поэтому `externalEventId` = `freedompay:result:<pg_payment_id>:<pg_result>` или `freedompay:payout:<pg_payment_id>:<pg_payment_status>`: у повтора он тот же.

**Result notify** (https://docs.freedompay.kz/12007677e0). Приходит `POST application/x-www-form-urlencoded`. Если в платеже задан `pg_request_method=XML`, вместо формы приходит одно поле `pg_xml` с корнем `request`; адаптер разбирает и его. Подпись — платёжным ключом. Значения `pg_result`: `1` — успех, `0` — неуспех, `2` — «not completed (sent only if enabled for your merchant)».
- Ответ, который ждёт Freedom Pay: HTTP 200 и `<?xml version="1.0" encoding="utf-8"?><response><pg_status>ok</pg_status></response>`. Подпись ответа документация не требует, поэтому ответ не подписан.
- **Мы никогда не отвечаем `rejected`**: при `pg_can_reject = 1` «a `rejected` answer refunds the payment». Отклонить уведомление значило бы вернуть деньги клиенту.
- Повторы: «No answer within 30 seconds or an HTTP code other than `2xx`» запускает повтор — через 15 минут, затем ещё дважды раз в 30 минут, всего 4 попытки.
- Если уведомление пришло без `pg_testing_mode=1` (то есть платёж живой), адаптер возвращает `ignored` и отвечает `ok`. На стенде такой платёж не подтверждается, его разбирает оператор.

**Payout notify** (https://docs.freedompay.kz/11622162e0). «always a POST with one field, `pg_xml`», корень `response`, подпись — выплатным ключом, скрипт — последний сегмент `pg_post_link`. Поля: `pg_status` (`ok`/`error`), `pg_payment_status` (`success`/`error`), `pg_payment_id`, `pg_order_id`, `pg_payment_amount`, `pg_failure_code`/`pg_failure_description`. Ответ: HTTP 200 или `<pg_status>ok</pg_status>`; адаптер отвечает так, как в примере документации. Повторы — «after about 4 minutes», «at most 3 attempts in total».

## 5. Подключение

Переменные окружения. Те, что уже есть в `env.ts`:
- `FREEDOMPAY_API_URL` — `https://api.freedompay.kz`; тестовый режим работает на том же хосте.
- `FREEDOMPAY_MERCHANT_ID`.
- `FREEDOMPAY_SECRET_KEY` — платёжный ключ.
- `FREEDOMPAY_PAYOUT_SECRET_KEY` — выплатный ключ. Без него `split` для мастера даёт `FAILED`, а Payout notify — `rejected`.

Новых переменных не нужно: URL уведомлений и возврата собираются из `APP_URL`. Необязательные настройки можно позже вынести в env:
- `clearing` — `two-stage` или `one-stage`;
- `merchantTimeZone` — по умолчанию `Asia/Almaty`;
- `payoutLinkHours` — по умолчанию 72;
- `paymentLifetimeSec` — по умолчанию 86400.

Строка для реестра провайдеров:

```ts
createFreedomPayProvider({
  appEnv: env().APP_ENV,
  apiUrl: env().FREEDOMPAY_API_URL!,
  merchantId: env().FREEDOMPAY_MERCHANT_ID!,
  secretKey: env().FREEDOMPAY_SECRET_KEY!,
  payoutSecretKey: env().FREEDOMPAY_PAYOUT_SECRET_KEY,
  resultUrl: `${env().APP_URL}/api/webhooks/freedompay/result`,
  payoutNotifyUrl: `${env().APP_URL}/api/webhooks/freedompay/payout`,
  payoutBackUrl: `${env().APP_URL}/deals`,
})
```

Маршруты `/api/webhooks/freedompay/result` и `/payout` должны передать в `handleWebhook` сырое тело (`readTextLimited`). Ответ маршрута — ровно `response` из результата; при `rejected` — 4xx.

## 6. Ограничения

### а) Двухстадийная оплата держит сумму ограниченный срок

- Схема задаётся параметром `pg_auto_clearing`: `1` — одностадийная, `0` — двухстадийная («authorize, then capture or cancel»). Если параметр не передан, действует настройка мерчанта (https://docs.freedompay.kz/overview-782024m0.md).
- Срок блокировки: «within 5 days (the period can be changed for the merchant)» (https://docs.freedompay.kz/11621002e0).
- По истечении срока платёж «captured or cancelled automatically, depending on the merchant settings». **Что именно происходит по умолчанию, списание или отмена, документация не говорит.**
- Срок настраивается для мерчанта; **верхняя граница не указана.**
- «Test payments are not processed automatically». Поэтому на стенде истечение блокировки не проверить.
- Частичное списание разрешено: «all or part of the amount», «The rest is released to the client», клиринг допускается только один. После частичного клиринга `cancel` невозможен.

Вывод: заказ мебели длится недели, а блокировка — около 5 дней. Двухстадийная оплата как «удержание до приёмки» без продления срока не подходит.

### б) Одностадийная оплата зачисляет деньги мерчанту

- В Result notify есть поле `pg_net_amount`: «Amount credited to you after the Freedom Pay commission». Значит, после списания деньги — у мерчанта.
- Выплаты идут с баланса мерчанта: «Payouts send money from the merchant's payout balance to a client's card or bank account» (https://docs.freedompay.kz/overview-782127m0.md). Есть код ошибки `1360` — «Insufficient payout balance».
- Если мерчант — ТОО платформы, то и при одностадийной оплате, и после клиринга двухстадийной деньги клиента лежат на балансе ТОО до выплаты мастеру. Это нарушает инвариант «деньги клиентов не проходят через счета ТОО». Поэтому адаптер разрешён **только в staging и только с `pg_testing_mode=1`**, пока Freedom Pay письменно не подтвердит схему без зачисления на баланс ТОО (например, эскроу или номинальный счёт).
- Доля платформы в `split` не переводится: она уже на балансе мерчанта. Это честное отражение той же проблемы, а не решение.
- **Не подтверждено документацией:** куда зачисляется платёж (баланс мерчанта или расчётный счёт), в какие сроки, и пополняется ли баланс выплат из принятых платежей автоматически.

### в) Чего нет в документации и что спросить у Freedom Pay

1. **Схема без зачисления на баланс ТОО.** Можно ли принимать деньги покупателя на эскроу, номинальный счёт или субсчёт сделки, с которого Freedom Pay сам выплатит мастеру и вернёт покупателю? Какой договор для этого нужен?
2. **Срок двухстадийной блокировки.** Каков максимум, на который его можно поднять для мерчанта? Что происходит по истечении по умолчанию — списание или отмена? Можно ли продлить блокировку конкретного платежа?
3. **Тестовый режим выплат.** У `reg2nonreg` и `to_iban` нет `pg_testing_mode`. Двигают ли выплаты тестового мерчанта реальные деньги? Нужно ли включить тестовый режим на весь мерчант («Test mode can also be enabled for the whole merchant: contact your account manager»)? До ответа выплатный ключ на стенд не выдаём, либо используем только тестовые карты выплат.
4. **Выплата на IBAN** (`/api/to_iban`, https://docs.freedompay.kz/11621076e0). Метод требует `pg_recipient_iin`, `pg_recipient_kbe`, `pg_knp`; в нашем интерфейсе `PayoutRecipient` их нет. Какие КБе и КНП нужны для выплаты мастеру — ИП или физлицу — за работы? Сейчас выплата идёт только через страницу ввода карты (`reg2nonreg`): `TODO(freedompay)` в `index.ts`.
5. **Баланс выплат.** Как он пополняется: из принятых платежей или отдельным переводом? Что означает ошибка `1806` («Corporate card for payouts not set up»)?
6. **Подпись ответов.** Каким ключом подписаны примеры ответов в документации? Как сплющивать вложенные списки (`pg_refund_payments`) при проверке подписи ответа `get_status3.php`?
7. **Ответ на Result notify.** Нужно ли подписывать ответ (`pg_salt`/`pg_sig`), как в прежних версиях протокола? Текущая документация описывает только `pg_status` со значениями `ok` и `rejected`.
8. **Часовой пояс мерчанта** для `pg_order_time_limit`.
9. **Допустимые символы `pg_order_id`.** Документация задаёт только «string, max 50»; наши ключи содержат `:`.
10. **Возвраты.** Есть ли срок, после которого возврат невозможен (в документации его нет)? Возврат синхронный или асинхронный? Документация говорит «Wait for the result» только для кода `91021`.

### г) Что остаётся вызывающему коду (deal-core)

- После подписи сверить сумму и валюту из уведомления с операцией журнала. Документация требует: «check the order: `pg_order_id`, amount, and currency». `WebhookResult` сумму не несёт: `TODO(freedompay)` в `webhook.ts`.
- `release` ищет платёж сделки по ключу `hold:<dealId>` (настройка `holdKeyOf`): ключ hold в deal-core должен совпадать.
- Порядок возврата при споре с двухстадийной оплатой: сначала `release` на долю мастера и платформы, после чего остаток разблокируется сам. Последующий `refund` на этот остаток возвращает `SUCCEEDED` без второго возврата (`released:<id>`). Частичный `refund` несписанной оплаты — `FAILED`: `revoke` сперва списал бы всю сумму.

## 7. Проверка

```bash
npx vitest run src/modules/payments/providers/freedompay   # подпись, XML, клиент, провайдер — без БД и сети
npx eslint src/modules/payments/providers/freedompay
```

Тесты используют подставной `fetch`. Ответы из документации в них переподписаны тестовым ключом. Настоящие ключи в коде и тестах не встречаются.
