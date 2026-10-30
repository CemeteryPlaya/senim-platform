# Прогресс

Задание — `docs/AGENT_PROMPT.md`. Обновляется после каждой фазы, чтобы работу можно было продолжить в новой сессии.

## Фаза A — фундамент

- [x] Прочитаны SKILL.md, AGENTS.md, README.md, PLAN.md, `src/`, `prisma/` старого MVP
- [x] Гигиена репозитория: служебные файлы агентов убраны из git (`e5538ca`)
- [x] `.env.example`, `docker-compose.yml` (Postgres 17, порт 5442, базы senim / senim_test / senim_e2e)
- [x] Инструменты: vitest (unit + integration на отдельной БД), Playwright, скрипты, GitHub Actions (только проверка)
- [x] Скелет модулей, ESLint-правило границ, `platform/` (env, db, errors, logger, crypto, jobs, rate-limit, action), `audit/` с триггером append-only
- [x] Prisma-схема и миграция по разделу 5
- [ ] Сид с тестовыми данными (агент сида)
- [x] Контракты провайдеров с моками: PaymentRail (manual, bank-заглушка), SignatureProvider (mock), StorageProvider (local), SmsProvider (mock), AiProvider (контракт)
- [x] Вертикаль `furniture`: типы, стили, материалы, правила сегмента с «Почему?», шаблоны этапов (в том числе без предоплаты)
- [ ] `ui-foundation`: токены, компоненты, оболочка, лендинг, витрина, проверка контраста
- [x] CLAUDE.md, скилл `project-standards`, `.claude/agents/*.md`, `docs/agents/PHASE_B_RULES.md`, глоссарий, ADR-001…003
- [ ] Коммит фазы A в main

## Фаза B — модули (worktree)
- [ ] deal-core-engineer · [ ] identity-engineer · [ ] marketplace-engineer · [ ] companies-engineer
- [ ] documents-engineer · [ ] platform-engineer · [ ] operator-engineer · [ ] ai-engineer

## Фаза C — интеграция
- [ ] Слияние веток по одной, миграции, typecheck/lint/test после каждой
- [ ] Обновить сид (документы, подписи, эскроу-сделка)

## Фаза D — проверка
- [ ] code-reviewer · [ ] security-reviewer · [ ] a11y-reviewer · [ ] qa-engineer (e2e)

## Фаза E — материалы для банка
- [ ] docs/bank/01–05, openapi.yaml, README

## Фаза F — итог
- [ ] docs/REPORT.md

## Журнал решений и действий

| Когда | Что | Почему |
|---|---|---|
| A | Postgres на 5442, dev-сервер на 3100 | 5440 и 3000 заняты другими проектами на машине |
| A | Старый UI удалён целиком, логика — в `e527b9d` | «логику переносим, вёрстку не сохраняем»; старый код не компилировался бы с новой схемой |
| A | Комиссия 6% убрана из модели | В решениях раздела 2 её нет, деньги не проходят через платформу (вопрос №3) |
| A | Чат привязан к отклику (`Message.offerId`) | Общение начинается с отклика и продолжается в сделке (ADR-003) |
| A | Документ подписывается по sha256 байтов PDF | Исправление проблемы №6 MVP |
| A | Журнал аудита защищён триггером БД, `scope` собирает историю сделки | Аргумент для банка: журнал нельзя подправить даже прямым SQL через приложение |
| A | Тексты разбиты по зонам `src/i18n/ru/*.ts` | Параллельные агенты не конфликтуют в одном файле |
| A | Мок подписи без состояния | На Vercel запросы попадают на разные инстансы |
| A | Cron на Vercel — раз в сутки | Hobby-план не позволяет чаще; см. OWNER_TODO |
| A | `TEST_DATABASE_URL`/`E2E_DATABASE_URL` обязательны, без дефолта в коде | Хук запрещает креды в коде; пример — в `.env.example` |
