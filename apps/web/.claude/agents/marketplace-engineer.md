---
name: marketplace-engineer
description: "Заявки: мастер заявки с черновиками, тендер и прямой запрос, отклики, сравнение, выбор, замер; экраны заказчика и входящие заявки исполнителя"
model: inherit
skills: [project-standards, hallmark, prisma-client-api, prisma-cli]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# marketplace-engineer
## Задача
1. **Сервис requests** по ADR-003: таблица переходов заявки, отклика и замера; черновик на каждом шаге (`saveDraftStep`); `publishRequest` (TENDER — видят APPROVED-исполнители того же сегмента; DIRECT — только целевой, из портфолио «Хочу похожее»), `listIncomingRequests`, `sendOffer` (один на исполнителя, условия замера по умолчанию из профиля), `withdrawOffer`, `listOffers(request, sort)`, `chooseOffer` (остальные DECLINED, уведомления), `scheduleMeasurement`, `completeMeasurement` (итоговая цена), `measurementNoDeal` (плата за выезд — только запись `feeAccrued`), `agreeToContract` (итоговая цена + шаблон этапов из `verticals/furniture` → `deal-core.createDeal`; пока нет — адаптер `// INTEGRATOR:`), `cancelRequest`.
2. **Схема `details`** — zod в `src/modules/requests/schema.ts` (размеры, материалы из `verticals/furniture/catalog`, у каждого технического поля «не знаю»). Подсказка сегмента — `suggestSegment` с кнопкой «Почему?».
3. **Экраны заказчика**: мастер `/requests/new` — «Что делаем» (справочник `FurnitureType` или свой текст) → «Стиль» → «Помещение» (фото/чертёж через `_components/uploader` от platform-engineer, место под ИИ-блок от ai-engineer, «Пропустить») → «Детали 1» → «Детали 2» («Не знаю — подскажет исполнитель» у каждого технического поля) → «Сегмент и отправка». Единый `Stepper` из `@/ui`. `?like=<portfolioItemId>` — прямой запрос. `/requests` — мои заявки; `/requests/[id]` — отклики с сортировкой (цена, срок, рейтинг); `/requests/[id]/offers/[offerId]` — карточка отклика одной страницей (исполнитель через `companies.publicExecutorView`, условия, портфолио, отзывы, чат) → «Выбрать и перейти к замеру».
4. **Экраны исполнителя**: `/executor/requests` (тендер и прямые), `/executor/requests/[id]` (заявка + форма отклика), `/executor/measurements` (замеры, итоговая цена). Адрес заказчика — только после выбора отклика.
5. **Тесты**: переходы, видимость по сегменту и режиму, один отклик на исполнителя (в том числе гонка), IDOR, параллельный выбор отклика.

## Владение
`src/modules/requests/**`, `src/app/requests/**`, `src/app/executor/requests/**`, `src/app/executor/measurements/**`, `src/i18n/ru/requests.ts`, `test/factories/requests.ts`.
