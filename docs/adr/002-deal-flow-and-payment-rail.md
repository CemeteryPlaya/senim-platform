# ADR-002. Путь сделки и PaymentRail

**Статус:** принято (фаза A). Детали переходов уточняет `deal-core-engineer` в коде (`transitions.ts`) и тестах.

## Контекст
Сейчас деньги идут напрямую исполнителю по этапам; цель — эскроу банка. Одна статусная машина должна работать в обоих режимах, а банку нужна готовая точка подключения.

## Решение

### Режим оплаты фиксируется в сделке
`Deal.paymentMode` берётся при создании из активного режима (`PAYMENT_RAIL` в env; в `DEMO_MODE` оператор может переопределить через `PlatformSetting["payments.rail"]`). Смена режима влияет только на новые сделки.

### Сделка
```
AWAITING_SIGNATURES ──(обе подписи договора)──► IN_PROGRESS            (manual)
                    └─────────────────────────► AWAITING_DEPOSIT ──(вебхук DEPOSIT_RECEIVED на всю сумму)──► IN_PROGRESS   (эскроу)
IN_PROGRESS ──(спор)──► DISPUTE ──(решение оператора)──► IN_PROGRESS | TERMINATED | COMPLETED
IN_PROGRESS ──(все этапы CLOSED)──► COMPLETED
AWAITING_SIGNATURES | AWAITING_DEPOSIT ──(отмена стороной)──► CANCELLED   (в эскроу — возврат внесённого)
```

### Этап
```
PENDING ──(предыдущий ACCEPTED; для ON_START — оплата этапа CONFIRMED)──► IN_PROGRESS
IN_PROGRESS | REWORK ──(исполнитель сдал с фото и отчётом)──► SUBMITTED   (autoAcceptAt = now + AUTO_ACCEPT_DAYS)
SUBMITTED ──(заказчик вернул с комментарием)──► REWORK
SUBMITTED ──(заказчик принял | автоприёмка)──► ACCEPTED   (создаётся акт этапа)
ACCEPTED ──(акт подписан обеими сторонами и оплата CONFIRMED или суммы нет)──► CLOSED
```

### Оплата этапа
- `manual`: `DUE → MARKED_PAID` (заказчик) `→ CONFIRMED` (исполнитель). Для `ON_START` оплата доступна сразу после начала сделки/закрытия предыдущего этапа, для `ON_ACCEPTANCE` — после `ACCEPTED`.
- эскроу: в тот же момент deal-core вызывает `rail.releaseTranche` с ключом `release:<stageId>`; при `SUCCEEDED` (или вебхуке `RELEASE_COMPLETED`) оплата становится `CONFIRMED`. Отметки сторон в эскроу не нужны.

### Споры
- `manual`: решение — запись и смена состояния (FAVOR_EXECUTOR → этап ACCEPTED; FAVOR_CLIENT → этап REWORK; TERMINATE → сделка TERMINATED). Денег платформа не двигает.
- эскроу: дополнительно `releaseTranche`/`refund` с ключами `dispute:<id>:release` / `dispute:<id>:refund`.

### PaymentRail (`src/modules/payments/rail.ts`)
`openAccount`, `getRequisites`, `releaseTranche`, `refund`, `getStatement`, `parseWebhook` (HMAC). Каждая денежная операция:
1. в транзакции создаёт `PaymentOperation` с уникальным `idempotencyKey` (повтор — та же запись, без второго вызова банка);
2. вызывает рельс с тем же ключом;
3. фиксирует результат; итог `PENDING` дожидается вебхука.
Вебхук: `BankWebhookEvent.externalEventId` уникален — повторная доставка не обрабатывается дважды. Сверка: `getStatement` против `PaymentOperation` (отчёт оператора).

### Гонки
Каждый переход — `updateMany({ where: { id, status: from } })` + `expectOneUpdated()`. Двойной клик «Принять этап» даёт одну приёмку и один транш.

## Последствия
- В `manual` нет шага пополнения и слова «эскроу» в интерфейсе.
- `escrow-simulator` честно подписан как симулятор и даёт банку увидеть полный цикл: счёт, реквизиты, пополнение вебхуком, транши, возврат, выписка, сверка.
