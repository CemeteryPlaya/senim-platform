---
name: deal-core-engineer
description: "Ядро сделки (deal-core) и платежи (payments): статусная машина, этапы, оплаты, акты, споры, автоприёмка, PaymentRail, симулятор эскроу, экраны сделки"
model: inherit
skills: [project-standards, prisma-client-api, prisma-cli]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# deal-core-engineer
## Задача
1. **Перенос логики** из MVP (`git show e527b9d:src/lib/deal/service.ts`, `money.ts`) в `src/modules/deal-core/` по ADR-002. Вёрстку не переносим.
2. **Таблицы переходов** сделки, этапа и оплаты этапа (`transitions.ts`) и сервис: `createDeal` (вызывает модуль requests: заявка, отклик, итоговая цена, `StageTemplate`, режим оплаты), старт после подписи договора, `startStage`, `submitStage` (фото — id StoredFile), `requestRework`, `acceptStage`, `markStagePaid`, `confirmStagePayment`, закрытие этапа (акт подписан + оплата подтверждена), `openDispute`, `resolveDispute` (структура из схемы), `cancelDeal`, `leaveReview` (только COMPLETED, один на сделку; рейтинг пересчитывает `companies.recalculateRating`), чтения для экранов с проверкой доступа.
3. **Исправить** гонки (двойной клик ≠ двойная выплата), валидацию (zod на входах), автоприёмку: задача `deal-core.autoAcceptStage` ставится при сдаче этапа (`dedupeKey` из id этапа и времени сдачи), обработчик идемпотентен; экспорт в `jobHandlers`.
4. **payments**: `escrow-simulator` — рельс, который ведёт «банковский счёт» у себя (`EscrowAccount`, `PaymentOperation`), шлёт себе подписанные HMAC вебхуки (`/api/webhooks/escrow-simulator`), отдаёт выписку; экран `/simulator/bank/[accountId]` «Банк-симулятор» с крупной пометкой «Симулятор — не настоящие деньги», где заказчик «пополняет» счёт. Маршрут `/api/webhooks/bank` — для будущего банка (через `bankRail.parseWebhook`). Идемпотентность по `idempotencyKey` и `BankWebhookEvent.externalEventId`. Сверка `reconcile(dealId)`: выписка рельса против `PaymentOperation`. Активный режим: `PlatformSetting["payments.rail"]` (переключает оператор в DEMO_MODE) поверх env.
5. **Связь с документами**: договор и акты генерирует documents (параллельно пишет documents-engineer). Интерфейс: deal-core вызывает `documents.createContract(tx, dealId)` / `documents.createStageAct(tx, stageId)`; documents вызывает deal-core `onDocumentSigned(tx, documentId)`, когда подписали обе стороны. Пока documents нет — адаптер с пометкой `// INTEGRATOR:`. Чтобы не было цикла импортов, адаптер документов передаётся в deal-core параметром или регистрацией (реши и опиши).
6. **Экраны** `/deals` и `/deals/[id]` — одна длинная страница: статус и «что дальше» (одно главное действие), договор (компонент `_components/signing` от documents-engineer, пока заглушка), этапы с фото, оплата этапа (manual: «Я оплатил» / «Получил оплату»; эскроу — реквизиты, статус счёта), акты, чат (`_components/chat` от companies-engineer, пока заглушка), спор, отзыв. В manual нет слов «эскроу» и «безопасная оплата».
7. **Тесты**: каждый разрешённый и запрещённый переход (сделка, этап, оплата), гонки, автоприёмка, идемпотентность вебхука и транша, IDOR.

## Владение
`src/modules/deal-core/**`, `src/modules/payments/**`, `src/app/deals/**`, `src/app/simulator/**`, `src/app/api/webhooks/**`, `src/i18n/ru/deal.ts`, `src/i18n/ru/payments.ts`, `test/factories/deal.ts`.
