# Новый интерфейс, этап 2 «Гость и вход» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** в новом интерфейсе под `/v2` появляются первые настоящие экраны: гостевая главная, «О сервисе», каталог работ, профиль мастера и весь вход — выбор роли, телефон и код, согласие, ФИО и ИИН, почта с подтверждением кодом.

**Architecture:** экраны v2 вызывают существующие модули `src/modules/*` (домен не меняется) и собираются только из `@/kit`. Барьеры входа (согласие, знакомство, почта) для v2 живут в `src/app/(app)/_shell/auth.ts` и ведут на адреса v2 через `to()`; модуль identity в web получает только новые функции почты. Подтверждение почты кодом — новые RPC в Go-сервисе `identity` по образцу OTP телефона.

**Tech Stack:** Next.js 16.4.3, React 19, Tailwind 4, `@/kit`; Go (connect-go, sqlc, goose, buf) для `identity`; vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-12-frontend-redesign-design.md` — разделы 5–8, 10, 12 и раздел 14 (уточнения этапа 1). Правила вида: `docs/design/v3/rules.md`, `checklist.md`, справочник `components.md`.

## Global Constraints

- Пути — от `apps/web/`, если не сказано иное. Ветка `frontend-v2`, без worktree, без `git stash`, без пуша. Коммит только своих файлов по явным путям; корневой `.gitignore` не коммитить.
- v1 (`src/app/(legacy)`, `src/ui`) заморожен: поведение не менять. Существующие функции модулей не менять по сигнатуре; новое — добавлять рядом.
- Экраны v2: импорт компонентов только из `@/kit`; тексты только из `ru.app` (`src/i18n/ru/app/*.ts`, новые файлы зон — `guest.ts`, `login.ts`); адреса только через `to()`; версии — только `desktop:` / `mobile:`. Сторожа `src/kit/guards.test.ts` обязательны.
- Экран: один `<h1>`, не больше одного `data-primary-action`, «Назад» с названием родителя на вложенных, первая карточка отвечает «что сейчас» там, где есть процесс. На компьютере — `Split` / `Narrow`, страница не выглядит растянутой телефонной.
- Слов «демо», «комиссия», «эскроу», «тестовый» в текстах v2 нет. Покупатель — «Защита сделки (2%)», мастер — «Гарантия оплаты и клиента (4%)», «деньги в банке под защитой». Контакты мастера и его имя скрыты по ADR-006: v2 показывает ровно то, что отдаёт `toPublicView` / `executorDisplay`.
- Каждый вход на сервер: zod-схема, затем проверка пользователя и прав первой строкой; server actions — через `action()` из `@/platform/action`. Изменяющие вызовы identity несут `idempotency_key` (его создаёт серверный модуль).
- Без `any`, без `console.log`. Go: `log/slog`, ошибки кодами (`rpcError`), тексты ошибок — только в `ru`.
- Хуки запрещают пути и команды с подстрокой «точка + env» и чтение `.pem` / `.key`.

### Проверки (решение владельца 13.11.2026: полная проверка раз на группу)

- **Внутри задачи** исполнитель запускает только точечные проверки:
  `cd /d/senim-platform && cd apps/web && npx tsc --noEmit && npx eslint <затронутые пути> && npx vitest run --project unit <затронутые пути>`; интеграционные тесты своего модуля — `npx vitest run --project integration <файл>` с `DATABASE_URL` и `TEST_DATABASE_URL` на `senim_v2web_test`.
  Go: `export PATH="/c/Program Files/Go/bin:$HOME/go/bin:$PATH"`, затем `go vet ./services/identity/... && go test ./services/identity/...` (без `-race`; для testcontainers `DOCKER_HOST=npipe:////./pipe/docker_engine`).
- **В конце группы** (A, B, C, D) автор запускает один раз: полный `npm run check`, e2e v2, для группы A — ещё `go tool golangci-lint run ./...`, `go tool buf lint`, `go test ./...`; в конце этапа — полный e2e v1.
- Обязательно `cd /d/senim-platform && cd apps/web` (строчная буква диска ломает vitest).

### Порты и фоновые процессы

- Один dev-сервер на `3110`, стенд — `identity` + `mesh`. Сейчас оба подняты автором и оставлены владельцу для просмотра: исполнитель их переиспользует и НЕ останавливает; своих не поднимает. Если сервер не отвечает — сообщить автору, а не поднимать второй.
- После изменения Go-кода `identity` стенд пересобирается автором в конце группы A (`BUILDX_BAKE_ENTITLEMENTS_FS=0 npm run v2:up`), исполнитель группы A проверяет Go тестами.
- Снимки: `npx tsx scripts/shots.ts <пути без ведущего слэша>`; для экранов за входом исполнитель задачи D1 добавляет скрипту вход по коду (см. задачу).
- Не занимать `3000`, `3100`, `5440`, `5442`.

## Harness

Как на этапе 1, с двумя изменениями:

1. Полная проверка — раз на группу (см. выше).
2. Ревью вида по снимкам — на каждую задачу с экраном (телефон: первый экран и полная страница; компьютер; обе темы).

Цикл задачи: бриф → исполнитель (Sonnet 5.5 — экраны; Opus 5.5 — Go, барьеры входа, вход) → точечные проверки → ревью кода и ревью вида независимо → до трёх кругов правок → журнал. Журнал: `.superpowers/sdd/2026-11-13-frontend-redesign-02-guest-and-login/progress.md`.

## Review Focus

1. **Возврат после входа** (`next`): внешний адрес, `//host`, `/\host`, адрес v1 — после входа человек попадает только на свой сайт; `next` переживает все шаги (согласие, знакомство, почта). → задача C1.
2. **Повтор и гонки кода почты:** двойной клик «Получить код», старый код после запроса нового, шестая попытка, истёкший код, чужой адрес — ни одного двойного эффекта; ошибки — понятным текстом. → задачи A1, D2.
3. **Существующий пользователь без почты** заходит в v2: его останавливает барьер почты, после подтверждения он возвращается туда, куда шёл; сотрудников барьер не касается. → задачи C1, D2.
4. **Пустой и длинный каталог:** ноль работ по фильтру (обучающий пустой экран со сбросом фильтра), страница за пределом, неизвестный фильтр в адресе, работа с очень длинным названием, 12 карточек на телефоне 360 px. → задача B2.
5. **Скрытые данные мастера:** ни телефон, ни Instagram, ни юридическое имя (в режиме HIDDEN), ни ИИН/БИН не попадают в разметку v2 каталога и профиля — в том числе в `alt`, `title`, JSON в скриптах страницы. → задачи B2, B3.

---

## Структура файлов

```
src/kit/                                   новые: Notice, HiddenField, CodeField, PhoneField, Chips, Pagination, ActionDock, WorkCard, Rating
src/app/(app)/error.tsx                    ошибка страницы v2
src/app/(app)/_shell/auth.ts               барьеры входа для v2 (редиректы через to())
src/app/(app)/_shell/form.ts               useActionForm — вызов server action из формы kit
src/app/(app)/v2/page.tsx                  главная: гость — лендинг; вошедший — пока прежний образец
src/app/(app)/v2/about/                    о сервисе
src/app/(app)/v2/catalog/                  каталог
src/app/(app)/v2/executors/[publicNumber]/ профиль мастера
src/app/(app)/v2/login/                    роль → телефон → код
src/app/(app)/v2/consent/                  согласие
src/app/(app)/v2/welcome/                  ФИО и ИИН
src/app/(app)/v2/email/                    почта и код
src/modules/identity/email.ts              requestEmailCode, verifyEmailCode, needsEmail
src/i18n/ru/app/guest.ts, login.ts         тексты
proto/senim/identity/v1/identity.proto     (корень) RequestEmailCode, VerifyEmailCode, Person.email_verified
services/identity/                         (корень) миграция, обработчики, отправитель почты с моком
e2e-v2/guest.spec.ts, login.spec.ts        сквозные сценарии
```

---

## Группа A. Подтверждение почты в identity

### Task A1: RPC почты в `identity` (Opus 5.5)

**Files (от корня репозитория):**
- Modify: `proto/senim/identity/v1/identity.proto`; сгенерированное — `go tool buf generate` (обновит `gen/go` и `apps/web/src/gen`)
- Create: `services/identity/migrations/00NN_email_verification.sql` (следующий номер), `services/identity/queries/email.sql`, `services/identity/internal/email.go`, `email_sender.go`, `email_test.go`
- Modify: `services/identity/internal/config.go`, `config_test.go`, `person.go` (сброс подтверждения при смене адреса), `deploy/compose/dev.vars` и пример переменных identity

**Interfaces — Produces:**

```proto
message RequestEmailCodeRequest { string session_token = 1; string email = 2; string idempotency_key = 3; }
message RequestEmailCodeResponse { google.protobuf.Timestamp expires_at = 1; string demo_code = 2; }  // demo_code — только при провайдере mock
message VerifyEmailCodeRequest { string session_token = 1; string code = 2; string idempotency_key = 3; }
message VerifyEmailCodeResponse { Person person = 1; }
rpc RequestEmailCode(RequestEmailCodeRequest) returns (RequestEmailCodeResponse);
rpc VerifyEmailCode(VerifyEmailCodeRequest) returns (VerifyEmailCodeResponse);
// Person: bool email_verified = <следующий номер поля>;
```

Поведение (образец — OTP телефона: `internal/otp.go`, `verify.go`, `otp_sender.go`):

- Только роли CLIENT и EXECUTOR, живая сессия (`liveSession`), вызывающий — web (`requireCaller`).
- `RequestEmailCode`: проверка формата адреса (та же, что в `UpdateContacts`); адрес нормализуется (обрезка пробелов, нижний регистр домена); прежние коды пользователя гасятся; код 6 цифр, хранится HMAC, срок 10 минут; лимиты: 1 запрос в минуту, 5 в час, 10 в сутки на пользователя. Адрес-кандидат хранится вместе с кодом и в `persons.email` не пишется до подтверждения.
- `VerifyEmailCode`: не больше 5 попыток на код, попытка засчитывается до сравнения; успех — в одной транзакции `persons.email = адрес-кандидат`, `persons.email_verified_at = now()`, код погашен, аудит `user.email_verified` (без самого адреса) в outbox.
- `UpdateContacts` с другим адресом сбрасывает `email_verified_at` (v1 продолжает работать как раньше, но адрес становится неподтверждённым).
- Отправитель: интерфейс `EmailSender.Send(ctx, email, code) error`; `mockEmailSender` пишет в журнал только факт; `demo_code` возвращается только при провайдере `mock` и в идемпотентный сохранённый ответ не попадает. Конфиг `IDENTITY_EMAIL_PROVIDER` через `Provider(…, ["mock"], ["mock"])` — мок запрещён при `APP_ENV=prod`.
- Коды ошибок: `invalid_email`, `email_code_too_often`, `email_code_too_many`, `email_code_expired`, `email_code_wrong` (параметр `left`), `email_code_attempts_exhausted`.

- [ ] **Step 1: тесты** `email_test.go` на реальной БД (как `otp_request_test.go`): успешный запрос возвращает `demo_code` из 6 цифр; повтор с тем же `idempotency_key` — тот же ответ без `demo_code` и без второго кода; второй запрос в ту же минуту — `email_code_too_often`; неверный код — `email_code_wrong` с `left=4`; пять неверных — `email_code_attempts_exhausted`, шестая попытка с верным кодом тоже отказ; истёкший код — `email_code_expired`; верный код — `person.email` равен адресу, `email_verified = true`, в outbox событие аудита без адреса в теле; после запроса нового кода старый не принимается; `UpdateContacts` с новым адресом → `email_verified = false`; оператор — отказ по роли; конфиг: мок при `APP_ENV=prod` — сервис не стартует и называет переменную.
- [ ] **Step 2:** запустить `go test ./services/identity/...` — падает.
- [ ] **Step 3:** реализовать; `go tool buf lint`, `go tool buf generate`, `go tool sqlc generate`.
- [ ] **Step 4:** `go vet ./services/identity/... && go test ./services/identity/...` — зелёные. Коммит `feat(identity): подтверждение почты кодом`.

### Task A2: почта в модуле identity web (Opus 5.5)

**Files:**
- Create: `src/modules/identity/email.ts`, `email.int.test.ts`
- Modify: `src/modules/identity/projection.ts`, `session.ts` (поле `emailVerified` в `CurrentUser`), `remote-errors.ts` (новые коды), `prisma/schema.prisma` + миграция (`User.emailVerifiedAt DateTime?`), `src/i18n/ru/app/login.ts` (тексты ошибок почты), `src/i18n/ru/app/index.ts`

**Interfaces:**
- Consumes: RPC из A1.
- Produces:
  - `requestEmailCode(user: CurrentUser, email: string): Promise<{ expiresAt: Date; demoCode: string | null }>`
  - `verifyEmailCode(user: CurrentUser, code: string): Promise<void>` — обновляет проекцию (`email`, `emailVerifiedAt`)
  - `needsEmail(user: Pick<CurrentUser, "role" | "roles" | "emailVerified">): boolean` — `false` для сотрудников (оператор), `true`, если почта не подтверждена
  - `CurrentUser.emailVerified: boolean`
  - `ru.app.login.email.errors`: тексты для шести кодов ошибок (в `email_code_wrong` — «Неверный код. Осталось попыток: N»).

- [ ] **Step 1: тесты** `email.int.test.ts` (против стенда, как `otp.int.test.ts`): запрос возвращает `demoCode`; верный код делает `emailVerified = true` в `CurrentUser` и в проекции; неверный код бросает `AppError` с кодом и текстом из `ru`; `needsEmail` — таблица случаев (заказчик без почты → true; с подтверждённой → false; оператор → false).
- [ ] **Step 2:** запустить точечно — падает. **Step 3:** реализовать. **Step 4:** точечные проверки зелёные. Коммит `feat(web): почта с подтверждением в модуле identity`.

**Конец группы A (автор):** пересобрать стенд, `go tool golangci-lint run ./...`, `go tool buf lint`, `go test ./...`, полный `npm run check`, e2e v1 `01-login`, `consent`, `smoke`.

---

## Группа B. Гость

### Task B0: дополнения kit для экранов (Sonnet 5.5)

**Files:** Create в `src/kit/`: `Notice.tsx`, `HiddenField.tsx`, `CodeField.tsx`, `PhoneField.tsx`, `Chips.tsx`, `Pagination.tsx`, `ActionDock.tsx`, `WorkCard.tsx`, `Rating.tsx`, `screens.test.tsx`; Create `src/app/(app)/error.tsx`, `_shell/form.ts`; Modify `src/kit/index.ts`, `guards.test.ts`, `fields.tsx`, `tokens.css`, `docs/design/v3/components.md` (корень), `src/i18n/ru/app/kit.ts`.

**Interfaces — Produces (экспорт из `@/kit`):**
- `Notice({ tone: "info" | "warn" | "danger"; title?: string; children; live?: boolean })` — плашка-сообщение в потоке; `live` → `role="alert"`. Оболочка переводит на неё плашку недоступности.
- `HiddenField({ name: string; value: string })` — единственный разрешённый способ скрытого поля; сторож 5 продолжает запрещать сырой `<input>` в `(app)`.
- `CodeField({ label, name, length?: 6, error? })` — одно поле `inputMode="numeric"`, `autoComplete="one-time-code"`, моноширинные цифры с разрядкой; `PhoneField({ label, name, error?, defaultValue? })` — `type="tel"`, `autoComplete="tel"`, подсказка формата из `ru`.
- `Chips({ items: { href: string; label: string; active: boolean }[]; label: string })` — ссылки-фильтры в строку с прокруткой на телефоне; активный — `aria-current="true"`.
- `Pagination({ page: number; pageCount: number; hrefFor: (page: number) => string; label: string })` — «Назад / Вперёд» и «Страница N из M»; при `pageCount <= 1` — `null`.
- `ActionDock({ children })` — на телефоне прилипает над панелью вкладок (главная кнопка экрана под большим пальцем), на компьютере — обычный блок в потоке.
- `WorkCard({ href, title, meta: string, priceFrom?: bigint, photo?: { src: string; alt: string } })` — карточка работы: `PhotoSlot` 4/3, заголовок, строка `meta`, «от N ₸».
- `Rating({ value: number | null; count: number })` — «4,8 · 12 отзывов» текстом, без звёзд-иконок в ряд; `null` → «Пока без отзывов».
- `useActionForm<T>(action, { onSuccess? })` из `@/app/(app)/_shell/form` → `{ pending, error, fieldErrors, submit(formData) }`; при ответе «сессия истекла» уводит на `to("/login")` с `next`.
- Сторожа: правило 6 ловит также `router?.push`, деструктуризацию `const { push } = useRouter()` и `href={{ pathname: "/…" }}`; правило 9 — `clientWidth`, `screen.width`; радио в `forced-colors` показывает выбор (утилита в `tokens.css`).
- `error.tsx` для `(app)`: заголовок, одна строка, кнопка «Повторить» (`reset`) и ссылка на главную; тексты из `ru.app.shell`.

- [ ] **Step 1:** тесты `screens.test.tsx` (точные атрибуты и классы через `@/kit/test-utils`): `Pagination` при `pageCount=1` → `""`, при `page=2,pageCount=5` — ссылки на 1 и 3 и текст «Страница 2 из 5»; `Chips` — у активного `aria-current`; `CodeField` — `inputmode="numeric"`, `autocomplete="one-time-code"`, `maxlength="6"`; `PhoneField` — `type="tel"`; `Rating value=null` → текст «Пока без отзывов»; `WorkCard` без фото не содержит `<img`; `Notice live` → `role="alert"`; `HiddenField` → `type="hidden"`; самопроверки новых шаблонов сторожей.
- [ ] **Step 2–4:** падение → реализация → точечные проверки; дописать разделы в `components.md`. Коммит `feat(web): дополнения kit для экранов гостя и входа`.

### Task B1: главная гостя и «О сервисе» (Sonnet 5.5)

**Files:** Modify `src/app/(app)/v2/page.tsx`; Create `v2/_home/GuestHome.tsx`, `v2/about/page.tsx`, тесты рядом, `src/i18n/ru/app/guest.ts`.

- Гость (`getShellUser().user === null`) видит лендинг: `<h1>` — обещание продукта одной строкой, под ним абзац, главное действие «Заказать мебель» → `to("/login")` с параметром роли покупателя, второстепенное «Я мастер» → `to("/login")` с ролью мастера; блок «Как это работает» — три шага карточками (заявка → предложения мастеров → деньги в банке под защитой до приёмки); блок доверия с `Explain` про защиту сделки; `HelpBlock` с тремя вопросами (ссылки на якоря `/v2/about`). На компьютере — `Split`: слева заголовок и действия, справа шаги; ниже — блоки во всю сетку по две колонки. Фотографий нет: `PhotoSlot` не используется на лендинге вовсе (заглушки на первой странице выглядят как недоделка).
- Вошедший пока видит прежний образец (заменится на этапе 3).
- `/v2/about`: `PageTitle` с «Назад: Главная», четыре раздела с якорями (как устроена защита денег; сколько это стоит — «Защита сделки (2%)» для покупателя и «Гарантия оплаты и клиента (4%)» для мастера, отдельными абзацами по ролям; что, если мебель не понравится; как стать мастером), в конце одно главное действие «Заказать мебель». Тексты — переработка `ru.landing.about` под правила раздела «Тексты», без слов «комиссия» и «эскроу».

- [ ] **Step 1:** тесты: у гостя один `<h1>`, один `data-primary-action`, обе ссылки ведут на `/v2/login` с разными значениями параметра роли; в разметке нет `<img`; `/v2/about` — четыре `<h2>` с `id`, один `data-primary-action`; в текстах зоны `guest` нет запретных слов (общий сторож).
- [ ] **Step 2–4:** падение → реализация → точечные проверки → снимки `v2 v2/about`. Коммит `feat(web): главная гостя и «О сервисе» в новом интерфейсе`.

### Task B2: каталог (Sonnet 5.5)

**Files:** Create `src/app/(app)/v2/catalog/page.tsx`, `_parts/catalog-view.ts`, тесты.

- Consumes: `parseCatalogFilter`, `catalogHref`, `PRICE_BUCKETS` (`@/modules/companies/catalog-filter`), `listCatalog`, `getCatalogFacets` (`@/modules/companies/catalog`).
- Produces: `catalogView(result, facets, filter)` — чистая view-модель: чипы типов и цен со ссылками `to(catalogHref(...))`, карточки `{ href: to("/executors/N") …}`, пагинация.
- Экран: `PageTitle` «Мастера и работы»; `Chips` типов мебели, вторым рядом `Chips` цены; сетка `WorkCard` (телефон — одна колонка, компьютер — три); `Pagination`; пустой результат — `EmptyState` «По этим условиям работ нет» с действием «Сбросить фильтр» (единственное главное действие в этом состоянии); при непустом — главного действия нет, вместо него `ActionDock` с «Заказать похожее» не ставится (действие — на карточке работы, этап 3).
- Неизвестный фильтр и страница за пределом обрабатываются так же, как в v1 (`parseCatalogFilter` нормализует; страница за пределом — пустой экран со ссылкой на первую страницу).

- [ ] **Step 1:** тесты `catalog-view` (чистая функция): ссылки чипов сохраняют остальные фильтры и сбрасывают страницу; активный чип помечен; 12 карточек; `pageCount`; пустой результат; интеграционный тест страницы (как `guest-pages.int.test.ts`): в HTML нет телефона, Instagram и юридического имени мастера в режиме HIDDEN (Review Focus 5), нет `/catalog` без префикса.
- [ ] **Step 2–4:** падение → реализация → точечные проверки → снимки `v2/catalog` и `v2/catalog?type=<slug>`. Коммит `feat(web): каталог в новом интерфейсе`.

### Task B3: профиль мастера (Sonnet 5.5)

**Files:** Create `src/app/(app)/v2/executors/[publicNumber]/page.tsx`, `_parts/executor-view.ts`, тесты.

- Consumes: `getPublicExecutorPage(publicNumber)` (`@/modules/companies`), типы `PublicExecutorView`, `PortfolioCard`.
- Экран: `PageTitle` с «Назад: Мастера» и заголовком `view.label`; первая карточка — сводка (`Rating`, «N сделок на платформе», стаж, условия замера) списком `ListRow`; «О мастере»; портфолио — сетка `WorkCard`; отзывы — карточки (текст уже очищен `maskContacts`); `Explain` «Почему имя и контакты скрыты» рядом со сводкой; одно главное действие в `ActionDock` — «Предложить заказ» → `to("/requests/new")` с параметром мастера (экран заявки — этап 3; сейчас ведёт на заглушку). `null` от модуля → `notFound()` (страница 404 v2).
- На компьютере — `Split`: слева портфолио и отзывы, справа сводка и действие.

- [ ] **Step 1:** тесты `executor-view`; интеграционный тест страницы: 404 для неизвестного номера; в HTML нет телефона, ИИН/БИН и (в HIDDEN) юридического имени, в том числе в `alt` и `title`; один `<h1>`, один `data-primary-action`.
- [ ] **Step 2–4:** падение → реализация → точечные проверки → снимки. Коммит `feat(web): профиль мастера в новом интерфейсе`.

**Конец группы B (автор):** полный `npm run check`, e2e v2 (новый `e2e-v2/guest.spec.ts` пишет исполнитель B3: гость проходит главная → каталог → фильтр → профиль мастера → «О сервисе» на телефоне и компьютере), сквозное ревью вида четырёх экранов.

---

## Группа C. Вход

### Task C1: барьеры v2 и вход — роль, телефон, код (Opus 5.5)

**Files:** Create `src/app/(app)/_shell/auth.ts`, `auth.test.ts`, `v2/login/page.tsx`, `LoginFlow.tsx`, `actions.ts`, `role-cookie.ts`, тесты; Modify `_shell/session-actions.ts` (выход ведёт на `to("/login")`), `_shell/nav.ts` (если меняются адреса), `src/i18n/ru/app/login.ts`.

**Interfaces — Produces:**
- `safeNext(raw: string | undefined): string | null` — только путь своего сайта под `/v2` (иначе `null`); `nextStepFor(user: CurrentUser, next: string | null): string` — адрес следующего обязательного шага: согласие → знакомство → почта → `next` или дом роли (`homeFor(user)`: заказчик `to("/")`, мастер одобренный `to("/executor/requests")`, мастер без профиля `to("/register/executor")`, оператор `to("/operator")`).
- `requireV2User(returnTo: string, ...roles): Promise<CurrentUser>` — для страниц: нет сессии → `to("/login")?next=…`; не пройден шаг → редирект на `nextStepFor`.
- `rememberRole(role: "CLIENT" | "EXECUTOR")`, `recallRole(): Promise<"CLIENT" | "EXECUTOR" | null>`, `forgetRole()` — подписанная кука (HMAC секретом сессий, 30 минут, `httpOnly`, `SameSite=Lax`); выбранная роль влияет только на дом после онбординга: выбравший «Я мастер» без профиля исполнителя попадает на `to("/register/executor")`. Роли в identity вход не меняет.
- Server actions (через `action()`): `chooseRoleAction({ role, next })`, `requestCodeAction({ phone })` → `{ expiresAt, demoCode }`, `verifyCodeAction({ phone, code, next })` → редирект на `nextStepFor`.

Экран `/v2/login` — мастер из трёх шагов на одной странице, `WizardHeader` «Шаг N из 3»:
1. «Что вы хотите сделать?» — `RadioGroup` из двух `RadioCard` («Заказать мебель», «Я мастер»), главное действие «Продолжить»; ниже — «Уже есть аккаунт? Войти» (сразу шаг 2). Параметр роли в адресе (с лендинга) предвыбирает карточку.
2. Телефон — `PhoneField`, главное действие «Получить код».
3. Код — `CodeField`, главное действие «Войти»; «Отправить ещё раз» с обратным отсчётом до повтора; «Изменить номер» возвращает на шаг 2; если identity вернул `demoCode` — `Notice` с кодом (текст из `ru`, без слова «демо»: «Сообщения пока не отправляются. Ваш код: …»).
Главное действие на телефоне — в `ActionDock`. Вошедший пользователь на `/v2/login` перенаправляется на `nextStepFor`.

- [ ] **Step 1: тесты** `auth.test.ts`: `safeNext` — таблица (`/v2/deals/1` → как есть; `/deals/1`, `//evil.com`, `/\evil.com`, `https://evil.com`, `` → `null`); `nextStepFor` — таблица по состояниям пользователя (без согласия → `/v2/consent?next=…`; без ФИО → `/v2/welcome?next=…`; без почты → `/v2/email?next=…`; всё есть и `next` → `next`; оператор → `/v2/operator`, барьер почты его не касается; мастер без профиля с выбранной ролью → `/v2/register/executor`); подпись куки роли: подделанное значение → `null`.
- [ ] **Step 2–4:** падение → реализация → точечные проверки (включая интеграционный тест actions против стенда) → снимки трёх шагов. Коммит `feat(web): вход с выбором роли в новом интерфейсе`.

### Task C2: согласие и ФИО с ИИН (Sonnet 5.5)

**Files:** Create `src/app/(app)/v2/consent/{page.tsx,ConsentForm.tsx,actions.ts}`, `v2/welcome/{page.tsx,WelcomeForm.tsx,actions.ts}`, тесты; тексты — существующие `ru.consent` (текст согласия не переписывать: это правовой текст) и новые подписи в `ru.app.login`.

- Consumes: `requireConsentSubject`, `grantPdConsent`, `needsConsent`, `recordOwnIdentity`, `needsIntroduction` (`@/modules/identity`); `nextStepFor`, `safeNext` (C1); `useActionForm`, `CodeField` и др. (B0).
- Согласие: `WizardHeader` (шаг онбординга), текст согласия в прокручиваемой карточке, `Checkbox` «Я согласен…», главное действие «Продолжить»; `Explain` «Зачем это нужно»; ссылка «Выйти» (второстепенная). После — `nextStepFor`.
- ФИО и ИИН: два поля, ошибки у полей сразу; `Explain` «Зачем ИИН»; главное действие «Продолжить».
- Номер шага онбординга считается по тому, что осталось пройти (согласие, знакомство, почта) — «Шаг N из M» честный для вернувшегося пользователя.

- [ ] **Step 1:** тесты: страницы без сессии уводят на вход; пройденный шаг пропускается (редирект на `nextStepFor`); ошибки identity (`fieldErrors`) показываются у полей; один `<h1>`, один `data-primary-action`.
- [ ] **Step 2–4:** падение → реализация → точечные проверки → снимки. Коммит `feat(web): согласие и знакомство в новом интерфейсе`.

**Конец группы C (автор):** полный `npm run check`, e2e v2 `login.spec.ts` (пишет исполнитель C2: новый номер проходит роль → телефон → код → согласие → ФИО; неверный код; возврат по `next`; существующий пользователь попадает в свой дом), ревью вида.

---

## Группа D. Почта и сквозной путь

### Task D1: вход для снимков и e2e (Sonnet 5.5)

**Files:** Modify `scripts/shots.ts`, `e2e-v2/support.ts` (создать), `playwright.v2.config.ts`.

- `scripts/shots.ts --as <phone>`: перед съёмкой входит по номеру через `/v2/login` (код берёт из плашки на экране), сохраняет состояние и снимает указанные пути вошедшим. Без `--as` — как сейчас.
- `e2e-v2/support.ts`: `loginV2(page, phone)`, `freshPhone()` (уникальный номер на прогон), `passOnboarding(page, { role })`.
- `playwright.v2.config.ts`: второй проект-набор `flows` с пересевом базы (`globalSetup` от v1), для сценариев, меняющих данные; `foundation` и `guest` остаются без пересева.

- [ ] Тест-прогон: `npx tsx scripts/shots.ts --as <номер> v2` даёт снимки вошедшего. Коммит `test(web): вход для снимков и e2e нового интерфейса`.

### Task D2: почта с подтверждением (Opus 5.5)

**Files:** Create `src/app/(app)/v2/email/{page.tsx,EmailFlow.tsx,actions.ts}`, тесты; Modify `e2e-v2/login.spec.ts`.

- Consumes: `requestEmailCode`, `verifyEmailCode`, `needsEmail` (A2); `nextStepFor` (C1).
- Экран — два шага на одной странице: адрес (`TextField type="email"`, `autoComplete="email"`, главное действие «Получить код») → код (`CodeField`, «Подтвердить», «Отправить ещё раз» с отсчётом, «Изменить адрес»); если вернулся `demoCode` — `Notice` «Письма пока не отправляются. Ваш код: …». `Explain` «Зачем почта» (чеки и копии документов). После успеха — `nextStepFor` и `forgetRole()`.
- Барьер действует и на существующих покупателей и мастеров; оператора не касается.

- [ ] **Step 1:** тесты: actions — успех, неверный код с числом попыток, слишком частый запрос, истёкший код (тексты из `ru`); страница пропускается, если почта подтверждена; e2e: полный путь нового покупателя до главной и нового мастера до заглушки регистрации; существующий пользователь без почты останавливается на `/v2/email` и после подтверждения попадает на исходный `next`; двойной клик «Получить код» не даёт второго кода (Review Focus 2).
- [ ] **Step 2–4:** падение → реализация → точечные проверки → снимки. Коммит `feat(web): почта с подтверждением кодом`.

### Task D3: завершение этапа (автор + ревьюеры)

- [ ] Полный `npm run check`, e2e v2 целиком, e2e v1 целиком, Go-проверки.
- [ ] Сквозное ревью вида всех экранов этапа (телефон и компьютер, обе темы) и итоговое ревью ветки (Opus).
- [ ] `docs/PROGRESS.md`, обновление `components.md`, журнал решений.
- [ ] Слияние в `main` без пуша; показать владельцу путь «гость → вход → почта» на стенде.
