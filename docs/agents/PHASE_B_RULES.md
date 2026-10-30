# Общие правила для агентов фазы B

Прочитай по порядку: `./SKILL.md` → `CLAUDE.md` → `docs/AGENT_PROMPT.md` (разделы 2, 4, 6) → `docs/GLOSSARY.md` → `docs/adr/*` → `docs/agents/UI_COMPONENTS.md` → `docs/design/MOCKUPS.md` (открой макеты своих экранов в `docs/design/mockups/`) → свой файл в `.claude/agents/`.

Демо-данные уже есть (`src/demo/`, персоны и сценарии — в отчёте сида ниже по ссылке `docs/agents/DEMO_DATA.md`). Формат `Request.details` в сиде: `widthCm`, `heightCm`, `depthCm`, `facade`, `countertop`, `hardware`, `color`, `unknown` (список полей «не знаю») — схема requests должна принять его или интегратор поправит сид. Фото портфолио в сиде: `StoredFile.provider = "static"`, ключ `demo/portfolio/<file>.svg` в `public/`.

## Владение файлами

Ты пишешь **только** в свои папки (см. свой агент-файл и таблицу ниже). Общие файлы не трогаешь:
`prisma/schema.prisma`, `prisma/migrations/`, `package.json`, `package-lock.json`, `src/platform/**`, `src/ui/**`, `src/jobs.ts`, `src/i18n/ru.ts`, `src/app/layout.tsx`, `src/app/page.tsx`, `eslint.config.mjs`, `CLAUDE.md`, чужие модули.

Нужна правка общего файла (поле в схеме, зависимость, компонент в `ui/`, метод в чужом модуле) — **не делай её**, а опиши в отчёте в разделе «Нужно от интегратора»: файл, точный diff или сигнатура, зачем. Пока правки нет — работай против интерфейса, мока или временного адаптера внутри своего модуля с пометкой `// INTEGRATOR:`.

| Зона | Владелец | Маршруты `src/app/` | Тексты |
|---|---|---|---|
| shell, лендинг, витрина | ui-foundation | `layout.tsx`, `page.tsx`, `ui-kit/`, `_shell/` | `common.ts`, `landing.ts` |
| identity | identity-engineer | `login/`, `register/`, `demo/`, `api/auth/` | `identity.ts` |
| companies + чат | companies-engineer | `catalog/`, `executors/`, `executor/profile/`, `executor/portfolio/`, `_components/chat/` | `companies.ts` |
| requests | marketplace-engineer | `requests/`, `executor/requests/`, `executor/measurements/` | `requests.ts` |
| deal-core + payments | deal-core-engineer | `deals/`, `simulator/`, `api/webhooks/` | `deal.ts`, `payments.ts` |
| documents | documents-engineer | `api/documents/`, `_components/signing/` | `documents.ts` |
| files + notifications | platform-engineer | `api/files/`, `notifications/`, `_components/uploader/`, `_components/notifications/` | `files.ts`, `notifications.ts` |
| operator | operator-engineer | `operator/`, `bank-demo/` | `operator.ts`, `bankDemo.ts` |
| ai | ai-engineer | `api/ai/`, `_components/ai-assistant/` | `ai.ts` |

Компоненты, которые встраиваются в чужие экраны (`_components/chat`, `_components/signing`, `_components/uploader`, `_components/ai-assistant`, `_components/notifications`), — с понятными пропсами и примером использования в отчёте.

## Межмодульные контракты (фаза A)

Сигнатуры функций, которые один модуль вызывает у другого, зафиксированы **типами** — реализуй и экспортируй из своего `index.ts` под этим именем и типом (`export const createDeal: CreateDeal = async (tx, input) => …`):

| Кто вызывает → кто реализует | Тип | Где описан |
|---|---|---|
| requests → deal-core | `CreateDeal` (`createDeal`) | `src/modules/deal-core/contracts.ts` |
| documents → deal-core (через экран) | `OnDocumentSigned` (`onDocumentSigned`) | там же |
| operator → deal-core | `ResolveDispute` (`resolveDispute`) | там же |
| deal-core → documents | `CreateContract`, `CreateStageAct` | `src/modules/documents/contracts.ts` |
| экран сделки → documents | `CompleteSigning` (`completeSigning`, хук `onFullySigned`) | там же |
| все экраны заказчика → companies | `GetPublicExecutorView` (`publicExecutorView`) | `src/modules/companies/index.ts` |
| deal-core → companies | `RecalculateRating` (`recalculateRating`) | там же |
| operator → identity | `ReviewExecutorRegistration` (`reviewExecutorRegistration`) | `src/modules/identity/index.ts` |
| operator → payments | `Reconcile` (`reconcile`) | `src/modules/payments/index.ts` |

Помощник ИИ не вызывает requests: экран мастера заявки (marketplace) сам переносит `RequestDraftSuggestion` в черновик.

Пока чужой реализации нет в твоём worktree, вызывающая сторона пишет **рабочий** временный адаптер внутри своего модуля (например, прямой запрос через Prisma с той же сигнатурой) с пометкой `// INTEGRATOR: заменить на <модуль>.<функция>`. Хук окружения блокирует запись функций-заглушек, которые только бросают «not implemented», — не пиши их.

## Как писать код

- Сервис модуля: функции в модуле принимают `user: CurrentUser` (из `@/modules/identity`) и проверяют права сами (защита от IDOR: заказчик видит только свои заявки и сделки, исполнитель — только свои отклики и сделки, оператор — всё).
- Server Action: `export const doX = action("module.doX", schema, async (input) => { const user = await requireUser("CLIENT"); return service.doX(user, input); })` из `@/platform/action`. Файл с `"use server"` лежит рядом с экраном.
- Состояние меняется в `transaction()`; переход — `updateMany({ where: { id, status: from }, data })` + `expectOneUpdated()`; в той же транзакции `recordAudit(tx, { actor: actorOf(user), action, entity, scope, before, after })` и `notify(tx, …)` для второй стороны.
- Таблица переходов — данные в коде (`transitions.ts`: `from`, `to`, `who`, `guard`). Тесты `*.int.test.ts` на каждый разрешённый и каждый запрещённый переход; гонка — `Promise.all` из двух одинаковых вызовов, ожидаем ровно один успех.
- Фабрики тестовых данных — `test/factories.ts` (можно добавлять свои в `test/factories/<модуль>.ts`).
- Ошибки для пользователя — `fail.*` из `@/platform/errors` (сообщения по-русски).
- Тексты — только из `ru.<зона>` (`@/i18n/ru`). Даты и деньги — форматтеры из `@/ui` (после ui-foundation).
- UI — компоненты из `@/ui`; цвета, размеры, радиусы — только токены. Доступность — раздел 6 задания. Мобильный экран — основной.
- Next.js 16: `cookies()`, `headers()`, `params`, `searchParams` — асинхронные. Перед работой с роутингом, формами и Server Actions смотри `node_modules/next/dist/docs/01-app/`.

## Окружение

- Postgres уже запущен в Docker (`senim-pg`, порт 5442). Переменные передавай в командной строке, `.env*` читать и писать нельзя (хук):
  `export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5442/senim_test?schema=public"`.
- В worktree нет `node_modules`. Не ставь заново — подключи общие из основного дерева (зависимости никто не меняет): в PowerShell `New-Item -ItemType Junction -Path node_modules -Target D:\mvp-scale-arna\node_modules`. Затем `npx prisma generate` (клиент генерируется в `src/generated/prisma` твоего worktree).
- Интеграционные тесты делят одну базу `senim_test`, файлы идут последовательно. Если параллельный агент гоняет тесты одновременно, возможны помехи: для своих прогонов создай свою базу `docker exec senim-pg psql -U postgres -c "CREATE DATABASE senim_test_<агент>;"` и укажи её в `TEST_DATABASE_URL`.
- Проверка перед коммитом: `npm run typecheck && npm run lint && npx vitest run`.
- Коммиты — маленькие, Conventional Commits, тело: почему, что, как проверено; последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Не пушь.

## Отчёт (последнее сообщение)

1. Что сделано (по пунктам задачи).
2. Список файлов.
3. Как проверить (команды, маршруты, демо-персоны).
4. **Нужно от интегратора** — точные правки общих файлов.
5. Открытые вопросы (их же допиши в отчёт, `docs/OPEN_QUESTIONS.md` не трогай — его ведёт интегратор).
6. Использованные скиллы.
