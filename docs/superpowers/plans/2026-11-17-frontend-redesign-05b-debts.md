# Устранение недочётов этапов 1–5 — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** закрыть технические недочёты из разделов «Отложено» и «Долги» `docs/PROGRESS.md`, которые не ждут решения владельца, — так, чтобы повтор и двойное нажатие нигде не давали двойного эффекта, деньги и файлы оператора не оставляли мусора, а `identity` не тратила попытку кода на потерянный ответ.

**Architecture:** точечные правки в модулях `web` (`payments`, `operator`, `files`, `requests`, `companies`, `deal-core`), в `@/kit` и экранах v2, в `pkg/idem` и `services/identity`. Одна общая схема для «повтора от клиента»: форма один раз заводит ключ (UUID), модуль хранит его с созданной записью под уникальным индексом и на повтор отдаёт уже созданное.

**Tech Stack:** Next.js 16, Prisma 7, zod, vitest (unit, integration на `senim_v2web_test`), Playwright; Go (connect-go, pgx, sqlc, goose), buf.

**Spec:** `docs/superpowers/specs/2026-11-12-frontend-redesign-design.md` (разделы 9, 12, 19) и `CLAUDE.md` (Definition of Done, инварианты). Источник списка — `docs/PROGRESS.md`, разделы «Отложено» этапов 1–5, «мелочи удобства», «пересмотр вида» (долги).

## Что в план не входит (и почему)

- **Ждёт решения владельца:** реквизиты ручной оплаты и назначение платежа, ЭЦП на телефоне, содержимое выписки PDF, тексты согласий и уведомлений («отклик», «заказчик»), маскировка короткого имени мастера, один адрес почты у нескольких учётных записей, `Referrer-Policy`, 36 px на компьютере, `.claude` в истории git, `buf breaking`, города, фото партнёров, знак бренда.
- **Только на настоящем iPhone:** вырез и полоска «домой», скрытие панели при клавиатуре, задержка каркаса 300 мс.
- **Этап 6 (переключение):** всё из списка «Этап 6» раздела этапа 1.
- **Новые возможности, а не недочёты:** «Сделать обложкой», чипы сроков и гарантии, звёзды в отзыве, черновик сообщения в чате, перехват «Назад» браузера, отметка «непрочитано» в чатах, название банка по IBAN, общий код шагов входа и почты.
- **Уже закрыто (проверено 17.11.2026, вычеркнуть в задаче F1):** 404 диалога у человека с двумя ролями (переключение роли, тест в `chats.int.test.ts`); хук геолокации сдачи (`src/features/delivery/request-location.ts` с тестом); дорожка переключателя темы в тёмной теме (`contrast.test.ts`); повторное «Поделиться» — ссылка без состояния, повтор добавляет лишь запись аудита.
- Отказ проверки кода повторяется так же и у `VerifyOtp`, не только у `VerifyEmailCode` (запись в PROGRESS неточна) — C1 чинит оба.

## Global Constraints

- Каждый вход на сервер — zod-схема (`action()`), затем `requireUser(...)` первой строкой; в Go — проверка вызывающего и сессии первой строкой обработчика.
- Изменяющий метод принимает ключ повтора; повтор с тем же ключом даёт тот же результат, без второй записи.
- Конкурентные переходы — условный `updateMany` + `expectOneUpdated()` или `SELECT … FOR UPDATE`.
- Деньги — тиыны (`BigInt`); даты документов банка — по Астане (`Asia/Almaty`).
- Тексты — только русские, только из `ru`; новых строк — минимум.
- Компоненты экранов v2 — только из `@/kit`; сырой `<input>` в экранах запрещён (сторож, правило 5).
- Тестовые базы — только `senim_v2web_test` и `senim_v2web_e2e` на `localhost:5442`; порты 3000, 3100, 5440, 5442 не занимать; после проверки закрыть свои процессы (TaskStop оставляет `start-server.js` — добить по PID).
- Хуки: никаких путей и команд с «точка + env»; переменные — в командной строке.
- Коммит маленький, Conventional Commits по-русски, тело «почему / что / как проверено», последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; пуш — только по команде владельца.
- Go: `export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`; тесты без `-race`.
- Vitest — только из `cd /d/senim-platform && cd apps/web` (ловушка буквы диска).

## Review Focus

1. **Повтор после потерянного ответа:** сеть оборвалась после записи — повтор той же формы (тот же ключ) возвращает созданное раньше, а не вторую заявку, сообщение, отчёт или работу; новый заход в форму — новый ключ. Тест на каждое из четырёх действий (B1, B2).
2. **Дата документа банка «завтра» по Астане** в 23:30 по Астане: сервер отказывает, «сегодня» — принимает (A1).
3. **Подтверждение уже подтверждённой операции:** второй оператор или двойная отправка — `CONFLICT`, и скан не остаётся в хранилище (A1).
4. **Отказ кода по тому же ключу:** повтор `VerifyOtp`/`VerifyEmailCode` с тем же ключом после «неверный код» возвращает тот же отказ и не уменьшает число оставшихся попыток; новый ключ с верным кодом — вход (C1).
5. **Сохранение Instagram параллельно со сменой почты** не возвращает старую почту (C2).

---

## Группа A. Деньги, файлы и таблицы оператора

### Task A1: документ банка — дата по Астане на сервере, скан без мусора

**Files:**
- Modify: `apps/web/src/modules/payments/providers/manual.ts` (проверка даты в `confirmManualOperation`; новая `assertManualPending`)
- Modify: `apps/web/src/modules/payments/index.ts` (экспорт `assertManualPending`)
- Modify: `apps/web/src/modules/operator/money.ts` (`confirmBankOperationWithScan`)
- Modify: `apps/web/src/modules/files/upload.ts`, `apps/web/src/modules/files/index.ts` (`discardUnattachedFile`)
- Modify: `apps/web/src/app/(app)/v2/operator/money/actions.ts`, `apps/web/src/app/(legacy)/operator/money/actions.ts` (если там тот же порядок «сохранить скан → подтвердить»)
- Create: `apps/web/src/platform/astana.ts` (`astanaDate(now: Date): string` — `YYYY-MM-DD` по `Asia/Almaty`; заменить локальную копию в `v2/operator/money/page.tsx`)
- Test: `apps/web/src/modules/operator/money.int.test.ts`, `apps/web/src/platform/astana.test.ts`

**Interfaces:**
- Produces: `astanaDate(now: Date): string`; `assertManualPending(operator: CurrentUser, transactionId: string): Promise<void>` (NOT_FOUND — нет такой; CONFLICT — уже не PENDING); `discardUnattachedFile(fileId: string, uploadedById: string): Promise<void>` (удаляет запись и байты, только если файл не прикреплён и загружен этим человеком; иначе ничего); `confirmBankOperationWithScan(operator, input: { transactionId; bankDocNumber; bankDocDate: Date; scan: Uint8Array }): Promise<void>`.

- [ ] **Step 1: тесты.** В `money.int.test.ts`:
  - `«дата документа банка завтра по Астане — VALIDATION bankDocInFuture; сегодня — проходит»`: `vi.setSystemTime(new Date("2026-11-17T18:30:00Z"))` (23:30 по Астане), дата `2026-11-18` → `{ code: "VALIDATION" }` с текстом `ru.payments.errors.bankDocInFuture`; `2026-11-17` → успех.
  - `«операция уже подтверждена — CONFLICT, скан не сохранён»`: подтвердить один раз, второй вызов `confirmBankOperationWithScan` → `CONFLICT`; `db.storedFile.count({ where: { purpose: "BANK_DOCUMENT" } })` не вырос.
  - `«отказ после сохранения скана (гонка) — скан удалён»`: подменить `confirmManualOperation` так, чтобы бросил `CONFLICT` после `saveBankDocument`; число `BANK_DOCUMENT` не выросло.
  - `astana.test.ts`: `astanaDate(new Date("2026-11-17T18:59:59Z")) === "2026-11-17"`, `astanaDate(new Date("2026-11-17T19:00:00Z")) === "2026-11-18"`.
- [ ] **Step 2: убедиться, что тесты падают** — `npx vitest run --project integration src/modules/operator/money.int.test.ts` (с `DATABASE_URL`/`TEST_DATABASE_URL` на `senim_v2web_test`).
- [ ] **Step 3: реализация.** `confirmManualOperation`: отказ, если `astanaDate(input.bankDocDate) > astanaDate(new Date())` (вместо допуска `+ DAY_MS`). `confirmBankOperationWithScan`: `assertManualPending` → `saveBankDocument` → `confirmBankOperation`; при любой ошибке после сохранения — `discardUnattachedFile(fileId, operator.id)` и проброс исходной ошибки. Действия v2 и v1 вызывают `confirmBankOperationWithScan` (порядок `requireUser` → `requireRecentMfa` прежний).
- [ ] **Step 4: тесты проходят** (та же команда + `npx vitest run src/platform/astana.test.ts`).
- [ ] **Step 5: коммит** `fix(web): документ банка — дата по Астане на сервере, скан не остаётся после отказа`.

### Task A2: хранилище `static` недоступно при `APP_ENV=prod`

**Files:**
- Modify: `apps/web/src/modules/files/registry.ts` (`storageByName`)
- Test: `apps/web/src/modules/files/registry.test.ts` (создать, если нет)

**Interfaces:** Consumes `env().APP_ENV`.

- [ ] **Step 1: тест** `«static при APP_ENV=prod — ошибка с именем провайдера; при dev — читает public/»`: `parseEnv`-окружение prod через `resetEnvCache` + `process.env.APP_ENV = "prod"` (с обязательными ключами, как в `env.test.ts`) → `storageByName("static")` отклоняется с сообщением, содержащим `static`; при `dev` — возвращает хранилище.
- [ ] **Step 2: тест падает.**
- [ ] **Step 3:** в ветке `case "static"` — `if (env().APP_ENV === "prod") throw new Error("Хранилище static (файлы сида) недоступно при APP_ENV=prod")`. Комментарий: файлы сида в рабочей базе не появляются (seedPlan), это вторая линия.
- [ ] **Step 4: тест проходит.**
- [ ] **Step 5: коммит** `fix(web): файлы сида (static) не читаются при APP_ENV=prod`.

### Task A3: `DataTable` — ссылка в первой ячейке на одной линии с соседями

**Files:**
- Modify: `apps/web/src/kit/DataTable.tsx` (класс ячейки-ссылки), при необходимости `apps/web/src/kit/TextLink.tsx` (вариант `inline` без `min-h-control`, с увеличенной областью нажатия через `before:` псевдоэлемент на высоту строки)
- Test: `apps/web/src/kit/data-table.test.tsx` (или существующий тест `DataTable`)

- [ ] **Step 1: тест** `«ссылка в ячейке — строчная: без min-h-control, базовая линия как у текста; область нажатия ≥ 48 px через псевдоэлемент»`: отрисовать `DataTable` с ячейкой `<TextLink inline …>`; в разметке ссылки нет `min-h-control`, есть класс области нажатия (`before:` с `min-h-control`).
- [ ] **Step 2: тест падает.**
- [ ] **Step 3:** вариант `TextLink inline` и его использование в первых столбцах таблиц оператора (`deals`, `disputes`, `executors`, `requests` в `src/app/(app)/v2/operator/**/page.tsx`).
- [ ] **Step 4:** тест проходит; снимок `/v2/operator/deals` на компьютере (1280) — строки ровные; сторож доступности (`guards.test.ts`) зелёный.
- [ ] **Step 5: коммит** `fix(kit): ссылка в первой ячейке таблицы — на линии текста, касание 48 px`.

---

## Группа B. Повтор и двойное нажатие без двойного эффекта

Общая схема (B1, B2): форма заводит ключ один раз при открытии (`useClientKey()` в `apps/web/src/app/(app)/_shell/client-key.ts`: `useState(() => crypto.randomUUID())`, новый ключ — после успешной отправки) и отправляет его скрытым полем `clientKey` (`HiddenField`); схема действия — `clientKey: z.string().uuid()`; модуль пишет `clientKey` в создаваемую запись; уникальный индекс `(владелец, clientKey)`; при нарушении уникальности модуль возвращает уже созданную запись тому же владельцу (чужую — никогда). Колонка необязательная: записи сида и v1 без ключа.

### Task B1: заявка (первый шаг) и сообщение в чате

**Files:**
- Create: `apps/web/src/app/(app)/_shell/client-key.ts` (`useClientKey(): { key: string; renew: () => void }`), тест `client-key.dom.test.tsx`
- Create: миграция `apps/web/prisma/migrations/20261117100000_client_keys_request_message/migration.sql`; Modify: `apps/web/prisma/schema.prisma` (`Request.clientKey String?` + `@@unique([clientId, clientKey])`; `Message.clientKey String?` + `@@unique([senderId, clientKey])`)
- Modify: `apps/web/src/modules/requests/schema.ts` (`saveDraftSchema`: `clientKey` обязателен, когда нет `requestId`), `apps/web/src/modules/requests/drafts.ts` (`saveDraftStep` → `createDraft` с ключом, на P2002 — найти свой черновик по ключу)
- Modify: `apps/web/src/modules/companies/chat.ts` (`sendMessage(user, offerId, text, attachments, clientKey)`), схемы и действия `apps/web/src/app/(app)/v2/chats/actions.ts`, `apps/web/src/app/(app)/v2/requests/new/actions.ts`, формы `WizardFrame.tsx`/первый шаг и `ChatComposer`-обёртка экрана диалога
- Test: `apps/web/src/modules/requests/drafts.int.test.ts`, `apps/web/src/modules/companies/chat.int.test.ts`

**Interfaces:**
- Produces: `useClientKey()`; `saveDraftStep(user, input & { clientKey?: string })`; `sendMessage(user, offerId, text, attachments, clientKey: string)`.

- [ ] **Step 1: тесты.**
  - `«первый шаг дважды с тем же ключом — один черновик, тот же requestId»`; `«тот же ключ у другого покупателя — свой черновик»`.
  - `«сообщение дважды с тем же ключом — одно сообщение, тот же id; вложения не прикреплены дважды»`.
  - `client-key.dom.test.tsx`: ключ стабилен между отрисовками, `renew()` даёт новый.
- [ ] **Step 2: тесты падают.**
- [ ] **Step 3: реализация** по общей схеме; v1 (`(legacy)`) не трогать — для него `clientKey` необязателен в модуле (колонка `null`).
- [ ] **Step 4: тесты проходят;** `npm run typecheck`; DOM-тесты экрана диалога и мастера заявки.
- [ ] **Step 5: коммит** `fix(web): повтор первого шага заявки и сообщения не создаёт второй записи`.

### Task B2: отчёт о ходе работ и работа портфолио

**Files:**
- Create: миграция `apps/web/prisma/migrations/20261117110000_client_keys_report_portfolio/migration.sql`; Modify: `schema.prisma` (`ProgressReport.clientKey String?` + `@@unique([dealId, clientKey])`; `PortfolioItem.clientKey String?` + `@@unique([executorId, clientKey])`)
- Modify: `apps/web/src/modules/deal-core/service.ts` (`addProgressReport(user, raw & { clientKey?: string })`), `apps/web/src/modules/companies/portfolio.ts` (`createPortfolioItem(user, raw & { clientKey?: string })`), их схемы
- Modify: действия и формы v2: `apps/web/src/app/(app)/v2/deals/[id]/progress/**`, `apps/web/src/app/(app)/v2/executor/portfolio/_parts/WorkForm.tsx` и действие
- Test: `apps/web/src/modules/deal-core/progress.int.test.ts` (или существующий тест отчётов), `apps/web/src/modules/companies/portfolio.int.test.ts`

**Interfaces:** Consumes `useClientKey()` из B1.

- [ ] **Step 1: тесты** `«отчёт дважды с тем же ключом — один отчёт, одно событие аудита, фото прикреплены один раз»`; `«работа портфолио дважды с тем же ключом — одна работа»`; `«тот же ключ в другой сделке — новый отчёт»`.
- [ ] **Step 2: тесты падают.**
- [ ] **Step 3: реализация** по общей схеме: проверка «уже есть по ключу» — внутри той же транзакции до записи аудита; на P2002 — вернуть найденное.
- [ ] **Step 4: тесты проходят;** PROGRESS-строки Ruling 10 и 13 этапа 4 закрываются.
- [ ] **Step 5: коммит** `fix(web): повтор отчёта о ходе работ и работы портфолио не создаёт второй записи`.

### Task B3: ввод брошенного первого шага не попадает в следующую заявку

**Files:**
- Modify: `apps/web/src/app/(app)/v2/requests/new/wizard-memory.ts` (метка сессии — из адреса, а не из `sessionStorage`), `apps/web/src/app/(app)/v2/requests/new/WizardFrame.tsx` или страница мастера (заводит `?w=<метка>` через `router.replace` при первом открытии без черновика)
- Test: `apps/web/src/app/(app)/v2/requests/new/wizard-memory.test.ts`, DOM-тест мастера

**Interfaces:** Produces `memoryKey(draftId: string | null, screen: WizardScreen, marker: string | null)`.

- [ ] **Step 1: тесты** `«новая заявка (адрес без w) — новая метка, ввод прошлой брошенной не подставляется»`; `«перезагрузка с тем же w — ввод на месте»`; `«после создания черновика ввод под меткой удалён»`.
- [ ] **Step 2: тесты падают.**
- [ ] **Step 3:** метка `w` в адресе (`new-<время36>`), без неё мастер заводит новую и заменяет адрес; ключи без черновика — `<префикс>:<w>:<шаг>`; после первого успешного сохранения — удалить ключи этой метки.
- [ ] **Step 4: тесты проходят.**
- [ ] **Step 5: коммит** `fix(web): ввод брошенной заявки не переходит в новую`.

---

## Группа C. identity

### Task C1: отказ проверки кода сохраняется по ключу

**Files:**
- Modify: `pkg/idem/idem.go` (`SaveRefusal`, `LookupRefusal`; хранение в той же таблице под методом `<method>#refusal`, ответ — `senim.common.v1.ErrorDetail` + код connect)
- Modify: `services/identity/internal/verify.go` (`VerifyOtp`), `services/identity/internal/email.go` (`VerifyEmailCode`)
- Test: `pkg/idem/idem_test.go`, `services/identity/internal/verify_test.go`, `services/identity/internal/email_test.go` (реальная БД стенда тестов identity, как в соседних тестах)

**Interfaces:**
- Produces: `func SaveRefusal(ctx context.Context, pool *pgxpool.Pool, method, key string, req proto.Message, code connect.Code, detail *commonv1.ErrorDetail) error`; `func LookupRefusal(ctx context.Context, pool *pgxpool.Pool, method, key string, req proto.Message) (*connect.Error, bool, error)` (другой запрос с тем же ключом — `ErrKeyReused`).

- [ ] **Step 1: тесты.** `TestVerifyOtpRefusalReplayed`: неверный код с ключом K → отказ `otp_invalid`; повтор с K → тот же отказ, счётчик попыток не изменился; новый ключ с верным кодом → вход. То же — `TestVerifyEmailCodeRefusalReplayed`. В `pkg/idem`: сохранить и прочитать отказ; другой запрос с тем же ключом — `ErrKeyReused`.
- [ ] **Step 2: тесты падают** — `go test ./pkg/idem/... ./services/identity/...`.
- [ ] **Step 3:** в обоих методах — `LookupRefusal` сразу после `Lookup` успеха; при `refusal != nil` из `checkCode`/`checkEmailCode` — `SaveRefusal` (ошибка записи — лог `Warn`, отказ отдаётся как есть). Срок хранения — та же очистка таблицы.
- [ ] **Step 4:** `go vet ./... && go tool golangci-lint run ./... && go test ./...` — без ошибок.
- [ ] **Step 5: коммит** `fix(identity): повтор проверки кода по тому же ключу возвращает прежний отказ`.

### Task C2: сохранение Instagram не перезаписывает почту

**Files:**
- Modify: `proto/senim/identity/v1/identity.proto` (в `UpdateContactsRequest` — `bool keep_email = 5;`), сгенерированный код (`go tool buf generate`, клиент web — `npm run v2:gen` или принятая в репозитории команда)
- Modify: `services/identity/internal/person.go` (`UpdateContacts`: при `keep_email` почта берётся из `before`, нормализация почты не выполняется), `services/identity/internal/store/*.sql` при необходимости
- Modify: `apps/web/src/modules/identity/contacts-profile.ts` (`updateContacts`: при `input.email === undefined` — `keepEmail: true`, без чтения `ownProfile`)
- Test: `services/identity/internal/person_test.go`, `apps/web/src/modules/identity/contacts-profile.int.test.ts` (или существующий)

- [ ] **Step 1: тесты** `TestUpdateContactsKeepEmail`: почта A, затем `UpdateContacts{instagram: "x", keep_email: true}` после смены почты на B другим запросом → почта B; web: `updateContacts({ instagram })` не читает профиль (заглушка `ownProfile` не вызывается) и шлёт `keepEmail: true`.
- [ ] **Step 2: тесты падают.**
- [ ] **Step 3: реализация;** `go tool buf lint` и `buf breaking` (новое поле — не разрыв).
- [ ] **Step 4:** Go-проверки и тест web проходят.
- [ ] **Step 5: коммит** `fix(identity): Instagram сохраняется без перезаписи почты`.

---

## Группа D. Экраны

### Task D1: «Мои данные» — согласие по сделке с названием заказа; «Отозвать мою цену» у покупателя

**Files:**
- Modify: `apps/web/src/app/(app)/v2/profile/data/page.tsx`, `data-view.ts` (`numbers` → `deals: Map<id, { number; title }>`), `apps/web/src/i18n/ru/app/profile.ts` (`deal: (n: number, title: string) => \`Сделка №${n}: ${title}\``), `apps/web/src/i18n/ru/app/offer.ts` (`withdraw: "Отозвать мою цену"`)
- Test: `data-view.test.ts`, тест текстов предложения покупателя (`offer-view.test.ts`)

- [ ] **Step 1: тесты** `«согласие по сделке — „Сделка №7: Кухня“, ссылка на сделку»`; `«кнопка отзыва встречной цены покупателя — „Отозвать мою цену“»`.
- [ ] **Step 2–4:** падают → правка → проходят (`npx vitest run "src/app/(app)/v2/profile" "src/app/(app)/v2/requests"`).
- [ ] **Step 5: коммит** `fix(web): согласие по сделке с названием заказа, «Отозвать мою цену» у покупателя`.

### Task D2: согласие — сброс отметки при новой редакции; отметка не под кнопкой на 320×568

**Files:**
- Test: `apps/web/src/app/(app)/v2/consent/consent.int.test.ts` (или существующий), `apps/web/e2e-v2/onboarding.spec.ts`
- Modify (если тест покажет): `apps/web/src/app/(app)/v2/consent/**` (запас снизу под док: `scroll-margin-bottom`/`pb` равный высоте дока)

- [ ] **Step 1: тесты.** Интеграционный `«согласие прошлой редакции — ворота ведут на /v2/consent, отметка снята, текущая версия в форме»` (засеять согласие с версией `2026-11-11-d0`). e2e `«320×568: отметка согласия видна и не перекрыта доком»` — `elementFromPoint` в центре флажка возвращает сам флажок или его подпись.
- [ ] **Step 2:** запустить; если e2e падает — Step 3, иначе отметить в отчёте, что раскладка уже верна.
- [ ] **Step 3:** запас под док на экране согласия.
- [ ] **Step 4:** тесты проходят.
- [ ] **Step 5: коммит** `test(web): согласие — новая редакция снимает отметку, флажок не под доком на маленьком экране`.

### Task D3: «Моё местоположение» в мастере заявки — общий помощник геолокации

**Files:**
- Modify: `apps/web/src/app/(app)/v2/requests/new/WizardPlace.tsx` (вызов `requestLocation` из `src/features/delivery/request-location.ts` вместо `navigator.geolocation` напрямую)
- Test: DOM-тест `WizardPlace` (`requestLocation` подменяется; отказ доступа — текст из `ru`, успех — точка в форме)

- [ ] **Step 1–4:** тест падает → замена → проходит.
- [ ] **Step 5: коммит** `refactor(web): мастер заявки берёт местоположение общим помощником`.

---

## Группа E. Фото

### Task E1: уменьшенные копии загрузок мастеров; лёгкое «последнее фото отчёта»

**Files:**
- Modify: `apps/web/prisma/schema.prisma` + миграция `20261117120000_stored_file_preview` (`StoredFile.previewKey String?`)
- Modify: `apps/web/src/modules/files/upload.ts` (`saveFile`: для назначений фото работ и отчётов — копия до 1024 px по длинной стороне, WebP, `sharp`; ключ `<key>.preview.webp`), `apps/web/src/modules/files/signing.ts` (подписанные ссылки: `variant: "preview" | "full"`), `apps/web/src/modules/files/cleanup.ts` (удалять и превью)
- Modify: списки и карточки v2, где фото меньше 1024 px (`WorkCard`, лента отчётов, главная мастера и покупателя), — ссылка на `preview`; галерея на весь экран — `full`
- Modify: `apps/web/src/modules/deal-core/progress*.ts` — `latestReportPhoto(dealId)`: один запрос `findFirst` по последнему отчёту с одним файлом (вместо загрузки всех отчётов)
- Test: `apps/web/src/modules/files/upload.int.test.ts`, тест чтения последнего фото

- [ ] **Step 1: тесты** `«фото работы 2560×1920 — превью WebP ≤ 1024 px, исходник цел»`; `«PDF — без превью»`; `«превью удаляется вместе с брошенным файлом»`; `«последнее фото отчёта — один запрос, фото последнего отчёта»`.
- [ ] **Step 2: тесты падают.**
- [ ] **Step 3: реализация;** старые файлы без превью отдаются исходником (`previewKey ?? key`).
- [ ] **Step 4:** тесты проходят; e2e v1 `09-access` (файлы только по подписанной ссылке) — зелёный.
- [ ] **Step 5: коммит** `perf(web): уменьшенные копии фото мастеров и лёгкое чтение последнего фото отчёта`.

---

## Группа F. Завершение

### Task F1: полная проверка, документы, слияние

- [ ] Полный `npm run check` (web) с `DATABASE_URL`/`TEST_DATABASE_URL` на `senim_v2web_test`; Go: `go vet ./... && go tool golangci-lint run ./... && go tool buf lint && go test ./...`.
- [ ] Пересев `senim_v2web_e2e`, e2e v2 (чтение и flows), e2e v1 — скрипт полной проверки из рабочей папки.
- [ ] `docs/PROGRESS.md`: вычеркнуть закрытые пункты «Отложено» и «Долги» (со ссылкой на коммит) и пункты из «Уже закрыто» выше; новый короткий раздел «Недочёты этапов 1–5 — закрыты (дата)»; `.superpowers/sdd/<план>/progress.md` — итог.
- [ ] Слияние в `main` без пуша; продакшн-стенд на 3110 пересобрать, если менялся web.
