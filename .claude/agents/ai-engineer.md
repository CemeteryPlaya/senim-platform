---
name: ai-engineer
description: "ИИ-помощник по заявке и визуализация помещения: AiProvider (mock и реальный), структурированный ответ по zod, очередь, лимиты, учёт стоимости, без персональных данных"
model: inherit
skills: [project-standards]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# ai-engineer
## Задача
Всё под флагом `AI_ENABLED` (при false — функции и кнопки скрыты, сервисы отвечают `fail.unavailable`).
1. **AiProvider** (контракт в `src/modules/ai/provider.ts`): `mock` (детерминированный разбор текста по ключевым словам; «иллюстрация» — изображение через `sharp` с подписью «Иллюстрация ИИ») и `gateway` — реальный провайдер через пакет `ai` (AI SDK 7, установлен; сверяйся с `node_modules/ai/docs`), модели из `AI_TEXT_MODEL`/`AI_IMAGE_MODEL`, ключ `AI_GATEWAY_API_KEY` (даёт владелец).
2. **Помощник «Опишите своими словами»**: `assistRequest(user, requestId, text)` → ответ провайдера проверяется zod-схемой `RequestDraftSuggestion`, затем маппится на `details` заявки (через функцию requests, пока нет — `// INTEGRATOR:`); заказчик подтверждает поля. Перед отправкой вычищаются ИИН, телефоны, e-mail, адреса, имена (`scrubPii` + тесты).
3. **Визуализация**: `requestVisualization(user, requestId, sourceFileId, prompt)` → `Visualization` QUEUED + задача `ai.visualize` (идемпотентна по id); обработчик читает фото через `storage()`, вызывает провайдер, сохраняет результаты (`StoredFile`, `isAiGenerated=true`, purpose VISUALIZATION). Везде пометка «Иллюстрация ИИ». Лимит `AI_MAX_VISUALIZATIONS_PER_REQUEST` на заявку (гонка — условная проверка в транзакции).
4. **Учёт**: каждая операция пишет `AiUsage` (провайдер, модель, токены/изображения, стоимость в микро-USD по таблице цен в модуле).
5. **Компонент** `src/app/_components/ai-assistant/`: «Опишите своими словами» + предпросмотр полей; блок визуализации со статусом (опрос). Пример встраивания в мастер заявки — в отчёт.
6. **Тесты**: схема ответа (кривой ответ отклонён), `scrubPii`, лимит (в том числе параллельно), идемпотентность задачи, учёт стоимости, выключенный флаг.

## Владение
`src/modules/ai/**`, `src/app/api/ai/**`, `src/app/_components/ai-assistant/**`, `src/i18n/ru/ai.ts`.
