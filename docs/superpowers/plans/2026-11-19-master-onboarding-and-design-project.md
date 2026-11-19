# Гибридный онбординг мастера и дизайн-проект в заявке — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Выбравший «Я мастер» проходит общие шаги, затем анкету мастера и попадает в кабинет мастера, не видя покупателя. Покупатель прикладывает к заявке свой дизайн-проект (PDF или фото): мастер видит его во входящей заявке, оператор может скрыть файл.

**Architecture:**
- **Онбординг.** Чистые правила выбора роли — в новом `_shell/role-choice.ts`. Их подключают вход, шаг почты, регистрация мастера, главная `/v2` и оболочка (`navFor`).
- **Дизайн-проект.** Новое назначение `REQUEST_DESIGN` в `modules/files` и поля скрытия у `StoredFile`. Привязку, проверку отметки и чтение делает `modules/requests`. Вид файлов (фото или PDF) отдаёт `modules/files` (`fileViews`): его читают и `requests`, и `deal-core`, без импорта между ними.
- Две части независимы. Задачи 1–5 — онбординг, 6–11 — дизайн-проект.

**Tech Stack:** Next.js 16.4.6 (App Router, Server Actions), Prisma 7 (миграции SQL руками), zod, Vitest (unit, integration на `senim_v2web_test`), Playwright (`e2e-v2/`).

**Spec:**
- `docs/superpowers/specs/2026-11-19-master-hybrid-onboarding-design.md`
- `docs/superpowers/specs/2026-11-19-request-design-project-design.md`

## Global Constraints

- **Окружение.** Работа в `apps/web`; правила — `apps/web/CLAUDE.md`, `SKILL.md`, `AGENTS.md`. Next 16: перед работой с Server Actions и кэшем смотри `node_modules/next/dist/docs/`.
- **Запуск vitest.** Только так: `cd /d/senim-platform && cd apps/web && npx vitest run --project unit|integration <файл>`.
  - Для integration: `DATABASE_URL=postgresql://postgres:postgres@localhost:5442/senim_v2web_test TEST_DATABASE_URL=<то же>`.
  - Путь с `(app)` указывай файлом целиком.
- **Базы.** Только `senim_v2web_test` и `senim_v2web_e2e` на localhost:5442. Никогда не трогать `senim`, `senim_test`, `senim_e2e`. Не запускать `npm run db:up`.
- **Интерфейс v2.** Компоненты только из `@/kit`. Тексты только из `ru` (`src/i18n/ru/app/*.ts`), не в разметке. Кнопки и поля ≥ 48 px, одно главное действие на экране, «Назад» видна.
- **Слова.** В текстах покупателя и мастера нет слов «комиссия» и «эскроу» (тесты `buyer-words.test.ts`, `master-words.test.ts`).
- **Серверные входы.** Каждый Server Action — `action()` с zod-схемой, первой строкой обработчика `requireUser(...)`.
- **Изменения заявки и файлов.** В `transaction()` с `recordAudit()` в той же транзакции. Повтор не даёт второго эффекта (`updateMany` с условием и `expectOneUpdated` или проверкой счётчика).
- **Миграции.** Пишутся руками: `prisma/migrations/20261119120000_request_design_project/migration.sql`. После — `npx prisma generate`.
- **Логирование.** Никаких `console.log`, только `logger`. Без `any`.
- **Порты.** 3000, 3100, 3110, 5440, 5442 не занимать. Dev-сервер для проверки — порт 3112 с `NEXT_DIST_DIR=.next-dbg`, после проверки остановить. `tsconfig.json`, если его изменил `next`, откатить.
- **Нельзя трогать.** `apps/web/.env.example` не трогать.
- **Коммиты.** Conventional Commits по-русски. Тело «почему / что / как проверено». Последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Файлы — явными путями. Не пушить.

## Review Focus

1. **`attachFiles` без `purpose` по полю `requestId`.** После появления `REQUEST_DESIGN` сохранение шага не должно привязать файл проекта как фото помещения и наоборот. Тест — задача 7.
2. **Отправка шага `room` в обход формы.** Если есть `designFileIds`, а `designContactsConfirmed` ложно, сервер отказывает ошибкой у поля. Отправка заявки с файлами проекта без `designConfirmedAt` тоже отказ. Тест — задача 7.
3. **Скрытый файл.** Мастер и вторая сторона сделки не получают ни ссылку в данных экрана, ни доступ через `canReadFile`. Покупатель-загрузчик и оператор получают. Тест — задача 6 (`decideFileAccess`) и задача 10 (чтение).
4. **Известный номер с обеими ролями выбирает роль на входе.** Активная роль переключается. У оператора и замерщика выбор игнорируется и не уводит их с их дома. Тест — задачи 1 и 2.
5. **Выбор «Я мастер» после отправки анкеты, выхода и «Сначала заказать мебель».** Выбор забыт: покупательские экраны того же человека потом работают как обычно. Тест — задача 2.

---

### Task 1: Правила выбора роли на входе

**Files:**
- Create: `src/app/(app)/_shell/role-choice.ts`
- Create: `src/app/(app)/_shell/role-choice.test.ts`
- Modify: `src/app/(app)/_shell/role-cookie.ts` (`ROLE_TTL_MS`, комментарии о сроке и о том, когда выбор забывается)

**Interfaces:**
- Produces:
  - `becomingMaster(user: Pick<StepUser, "role" | "executor">, chosen: ChosenRole | null): boolean` — `chosen === "EXECUTOR" && user.role === "CLIENT" && user.executor === null`.
  - `loginChoice(user: Pick<StepUser, "role" | "roles" | "executor">, chosen: ChosenRole | null): { keep: boolean; switchTo: "CLIENT" | "EXECUTOR" | null }`.
  - `ROLE_TTL_MS = 24 * 60 * 60_000`.

- [ ] **Step 1: Написать падающие тесты** в `role-choice.test.ts`:
  - `becomingMaster`: true для `{role:"CLIENT", executor:null}` + EXECUTOR; false для CLIENT + CLIENT, для `null`, для EXECUTOR-роли, для CLIENT с `executor:{status:"PENDING"}`.
  - `loginChoice`:
    - CLIENT без профиля + EXECUTOR → `{keep:true, switchTo:null}`;
    - CLIENT с ролями `["CLIENT","EXECUTOR"]` + EXECUTOR → `{keep:false, switchTo:"EXECUTOR"}`;
    - EXECUTOR с ролями обеими + CLIENT → `{keep:false, switchTo:"CLIENT"}`;
    - EXECUTOR + EXECUTOR → `{keep:false, switchTo:null}`;
    - OPERATOR и MEASURER с любым выбором → `{keep:false, switchTo:null}`;
    - `chosen === null` → `{keep:false, switchTo:null}`.
  - `ROLE_TTL_MS === 86_400_000`.
- [ ] **Step 2: Запустить** `npx vitest run --project unit "src/app/(app)/_shell/role-choice.test.ts"`. Expected: FAIL (модуля нет).
- [ ] **Step 3: Реализовать `role-choice.ts`.** Импортирует `server-only` не нужно: чистый модуль, типы из `./auth` и `./role-cookie` через `import type`. Поменять `ROLE_TTL_MS` и комментарии в `role-cookie.ts`.
- [ ] **Step 4: Запустить** тот же тест и `role-cookie.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): правила выбора роли на входе для гибридного онбординга мастера`.

### Task 2: Вход, шаг почты, регистрация и выход для передумавшего

**Files:**
- Modify: `src/app/(app)/v2/login/actions.ts` (`verifyCodeAction`)
- Modify: `src/app/(app)/v2/email/actions.ts` (`moveOn`)
- Modify: `src/app/(app)/v2/register/executor/actions.ts` (`registerMasterAction`; новое `forgetMasterChoiceAction`)
- Modify: `src/app/(app)/v2/register/executor/RegisterWizard.tsx` (ссылка на первом шаге при `origin === "home"` и `keepsBuyer`)
- Modify: `src/i18n/ru/app/master-register.ts` (`orderFirst: "Сначала заказать мебель"`)
- Test: `src/app/(app)/v2/login/actions.int.test.ts`, `src/app/(app)/v2/email/actions.int.test.ts`, `src/app/(app)/v2/register/executor/actions.int.test.ts`, `src/app/(app)/v2/register/executor/register.test.tsx`

**Interfaces:**
- Consumes: `loginChoice`, `becomingMaster` (Task 1); `switchRole` из `@/modules/identity`; `forgetRole`, `recallRole`.
- Produces: `forgetMasterChoiceAction = action("app.masterRegister.orderFirst", z.strictObject({}), …)`. Обработчик: `requireUser("CLIENT")`, `forgetRole()`, `shellChanged()`, `redirect(to("/"))`.

- [ ] **Step 1: Написать падающие int-тесты** по образцу существующих в этих файлах (cookie и redirect там уже разбираются):
  - вход известного номера (CLIENT без профиля) с выбором «executor» ведёт на `/v2/register/executor`, cookie выбора остаётся;
  - вход известного номера с ролями CLIENT и EXECUTOR при активной CLIENT и выборе «executor» переключает активную роль на EXECUTOR, cookie удалена;
  - вход оператора с выбором «executor» ведёт на 2FA, как раньше, cookie удалена;
  - шаг почты при выборе EXECUTOR и `executor === null` ведёт на регистрацию и cookie не удаляет; при выборе CLIENT — удаляет, как раньше;
  - `registerMasterAction` удаляет cookie;
  - `forgetMasterChoiceAction` удаляет cookie и ведёт на `/v2`; гостю — отказ;
  - DOM-тест: ссылка «Сначала заказать мебель» есть на первом шаге при `keepsBuyer`, высота ≥ 48 px по классу kit (`TextLink`).
- [ ] **Step 2: Запустить** int-тесты файлов. Expected: FAIL на новых случаях.
- [ ] **Step 3: Реализовать.**
  - В `verifyCodeAction` вместо `if (!verified.isNew) await forgetRole()`:
    1. `chosen = await recallRole()`, затем `user`.
    2. Если `!verified.isNew`: `const c = loginChoice(user, chosen)`. При `c.switchTo` — `await switchRole(user, c.switchTo)` и перечитать пользователя. При `!c.keep` — `forgetRole()`.
    3. Redirect через `nextStepFor(user, safeNext(next), <выбор, если он сохранён>)`.
  - В `moveOn`: `forgetRole()` только если `!becomingMaster(user, chosen)`.
- [ ] **Step 4: Запустить** те же тесты. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): выбор «Я мастер» живёт до отправки анкеты, и для известного номера тоже`.

### Task 3: Главная и оболочка для того, кто идёт к профилю мастера

**Files:**
- Modify: `src/app/(app)/v2/(home)/page.tsx`
- Modify: `src/app/(app)/_shell/nav.ts` (`NavUser.becomingMaster?: boolean`, `roleTabs`, `navFor`)
- Modify: `src/app/(app)/layout.tsx` (передать `becomingMaster(user, await recallRole())`)
- Test: `src/app/(app)/_shell/nav.test.ts`, `src/app/(app)/v2/page.test.tsx` (или `page.int.test.ts` — где уже проверяется выбор дома)

**Interfaces:**
- Consumes: `becomingMaster` (Task 1).

- [ ] **Step 1: Написать падающие тесты.**
  - `navFor({role:"CLIENT", executor:null, becomingMaster:true}, …)`: вкладки `[registration, profile]` (адреса `/v2/register/executor`, `/v2/profile`), `action` нет.
  - Без `becomingMaster` у CLIENT — как раньше, с `action` «Заказать мебель».
  - Главная: CLIENT без профиля с cookie EXECUTOR — redirect на `/v2/register/executor`.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** На главной в ветке `current.role === "CLIENT"`: `if (becomingMaster(current, await recallRole())) redirect(to("/register/executor"))`.
- [ ] **Step 4: Запустить** тесты, `nav.test.ts`, `shell.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): идущий к профилю мастера не видит главную и меню покупателя`.

### Task 4: Блок «Как взять заказ»

**Files:**
- Create: `src/app/(app)/v2/executor/_parts/HowToTakeOrder.tsx`
- Create: `src/app/(app)/v2/executor/_parts/HowToTakeOrder.test.tsx`
- Modify: `src/i18n/ru/app/master-requests.ts` (новая ветка `howTo`)
- Modify: `src/app/(app)/v2/register/executor/RegisterStatus.tsx` (статусы PENDING и APPROVED)
- Modify: `src/app/(app)/v2/_home/MasterHomeView.tsx`, `src/app/(app)/v2/_home/MasterHome.tsx` (в `MasterHomeData` — `showHowTo: boolean` = `!offered`)
- Test: `src/app/(app)/v2/_home/MasterHomeView.test.tsx`, `src/app/(app)/v2/register/executor/register.test.tsx`

**Interfaces:**
- Produces: `HowToTakeOrder({ beforeApproval }: { beforeApproval: boolean })`.
- Тексты `ru.app.masterRequests.howTo` — точные:
  - `title`: «Как взять заказ»
  - `beforeApproval`: «Заявки откроются после проверки анкеты.»
  - `steps`:
    1. «Новые заявки покупателей приходят в раздел «Заявки» — мы пришлём уведомление.»
    2. «Откройте заявку: фото помещения, размеры, пожелания и дизайн-проект, если покупатель его приложил.»
    3. «Отправьте предложение — цену и срок. Покупатель может предложить свою цену, договоритесь в переписке.»
    4. «Покупатель принимает предложение, вы оба подписываете оферту, он оплачивает — деньги в банке под защитой. Начинайте работу.»

- [ ] **Step 1: Написать падающие тесты.**
  - Блок рисует `<ol>` из 4 пунктов и заголовок уровня h2. При `beforeApproval` есть строка «Заявки откроются…».
  - `MasterHomeView` с `showHowTo:true` показывает блок, с `false` — нет.
  - Экран статуса PENDING показывает блок.
  - `master-words.test.ts` проходит.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** `Section` + `Card` из `@/kit`, `<ol>` с номерами из разметки списка. На главной — после «Сейчас» и первых шагов. Главного действия у блока нет.
- [ ] **Step 4: Запустить** тесты и `master-words.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): блок «Как взять заказ» у нового мастера`.

### Task 5: e2e — путь мастера без главной покупателя

**Files:**
- Modify: `e2e-v2/master-register.spec.ts`

- [ ] **Step 1: Добавить сценарии.**
  - (а) Новый номер `+7 700 000 9X XX` → «Я мастер» → согласие, ФИО и ИИН, почта → анкета (шапка есть, «Заказать мебель» нет) → переход на `/v2` возвращает на анкету → отправка → экран статуса с «Как взять заказ».
  - (б) Засеянный покупатель без профиля мастера (из `docs/agents/STAND_DATA.md`) → «Я мастер» → сразу анкета.
- [ ] **Step 2: Запустить** `npm run test:e2e -- e2e-v2/master-register.spec.ts` по `e2e-v2/README.md`. Expected: PASS. Если до задач 1–4 сценарий не проверялся, ветка (б) падает.
- [ ] **Step 3: Commit** `test(web): e2e пути «Я мастер» без главной покупателя`.

### Task 6: Назначение `REQUEST_DESIGN`, поля скрытия, доступ и вид файлов

**Files:**
- Modify: `prisma/schema.prisma`:
  - `FilePurpose.REQUEST_DESIGN`;
  - `StoredFile.hiddenAt DateTime?`, `hiddenById String?`;
  - `Request.designConfirmedAt DateTime?`.
- Create: `prisma/migrations/20261119120000_request_design_project/migration.sql`
- Modify: `src/modules/files/policy.ts` (`REQUEST_DESIGN: { roles: ["CLIENT"], accepts: "imageOrPdf", maxBytes: PDF_MAX, attachTo: { owner: "requestId" }, shortLink: true }`)
- Modify: `src/modules/files/access.ts` (`FileFacts.hidden: boolean`; `decideFileAccess`: скрытый — только оператор и загрузчик; `ownersSelect` берёт `hiddenAt`)
- Create: `src/modules/files/views.ts`; Modify: `src/modules/files/index.ts`
- Test: `src/modules/files/access.test.ts`, `src/modules/files/views.test.ts`, `src/modules/files/access.int.test.ts`

**Interfaces:**
- Produces:
  - `type FileView = { id: string; kind: "image" | "pdf"; src: string; n: number }`.
  - `fileViews(files: readonly { id: string; provider: string; storageKey: string; contentType: string }[], pdfName: (n: number) => string): Promise<FileView[]>`. `n` — номер с 1 по порядку; для PDF `fileUrl(f, { fileName: pdfName(n) })`.

- [ ] **Step 1: Написать падающие тесты.**
  - `decideFileAccess`: скрытый файл заявки — мастер сегмента false, заказчик-загрузчик true, оператор true; не скрытый — как раньше.
  - `fileViews`: PDF → `kind:"pdf"`, номера 1..n.
  - int: `canReadFile` скрытого файла мастером → false.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Миграция руками.**
  - `ALTER TYPE "FilePurpose" ADD VALUE 'REQUEST_DESIGN';`
  - `ALTER TABLE "StoredFile" ADD COLUMN "hiddenAt" TIMESTAMP(3), ADD COLUMN "hiddenById" TEXT;`
  - `ALTER TABLE "Request" ADD COLUMN "designConfirmedAt" TIMESTAMP(3);`

  Применить к `senim_v2web_test`: `DATABASE_URL=… npx prisma migrate deploy`. Затем `npx prisma generate`, политику, доступ, `views.ts`.
- [ ] **Step 4: Запустить** тесты `src/modules/files`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): назначение файла «дизайн-проект заявки» и скрытие файла оператором (схема, доступ)`.

### Task 7: Модуль requests — сохранение шага, отметка, отправка

**Files:**
- Modify: `src/modules/requests/schema.ts`:
  - `LIMITS.designFiles: 5`;
  - `roomStep` получает `designFileIds: z.array(z.string().min(1)).max(LIMITS.designFiles).default([])` и `designContactsConfirmed: z.boolean().default(false)`;
  - `.refine`: файлы есть → отметка true, `path: ["designContactsConfirmed"]`, текст `ru.requests.validation.designContactsRequired`.
- Modify: `src/modules/requests/drafts.ts`:
  - `linkRoomPhotos` передаёт `purpose: "REQUEST_ROOM"`;
  - новая `linkDesignFiles(tx, user, requestId, fileIds)` по тому же образцу с `REQUEST_DESIGN`;
  - `designConfirmedAt`: файлы есть → `r.designConfirmedAt ?? now`, нет → `null`;
  - аудит `request.draft_saved` получает `meta.designFiles`;
  - `requireComplete`: файлы проекта есть и `designConfirmedAt === null` → `fail.validation(ru.requests.validation.designContactsRequired)`.
- Modify: `src/i18n/ru/requests.ts`:
  - `validation.designContactsRequired`: «Отметьте, что убрали из файлов телефоны, адреса и имена»;
  - `validation.designTooMany`: «Не больше 5 файлов дизайн-проекта».
- Test: `src/modules/requests/schema.test.ts`, `src/modules/requests/drafts.int.test.ts`

- [ ] **Step 1: Написать падающие тесты.**
  - Схема: файлы без отметки → ошибка у `designContactsConfirmed`; 6 файлов → ошибка.
  - int:
    - сохранение шага с 1 PDF и отметкой → файл прикреплён с `purpose REQUEST_DESIGN`, `designConfirmedAt` задан;
    - тот же файл в `photoFileIds` → отказ `notOwn`, назначение не смешивается;
    - фото помещения не попадают в `REQUEST_DESIGN` и наоборот;
    - убрали все файлы → `designConfirmedAt === null`;
    - отправка с файлами и `designConfirmedAt = null` (выставить прямо в БД) → VALIDATION.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать** по Files.
- [ ] **Step 4: Запустить** `schema.test.ts`, `drafts.int.test.ts` и весь каталог `src/modules/requests` проектом integration. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): дизайн-проект в шаге «Помещение» с обязательной отметкой о контактах`.

### Task 8: Шаг «Помещение» и карточка заявки покупателя

**Files:**
- Modify: `src/modules/requests/drafts.ts`:
  - `getDraft` и `getClientRequest` получают `design: (FileView & { hidden: boolean })[]` и `designConfirmed: boolean`;
  - вызов `fileViews(…, (n) => \`design-${n}.pdf\`)`.
- Modify: `src/app/(app)/v2/requests/new/steps.ts` (`readStep("room")`: `designFileIds` из `getAll`, `designContactsConfirmed` = поле `"on"`)
- Modify: `src/app/(app)/v2/requests/new/WizardRoom.tsx`:
  - блок «Свой дизайн-проект»: `Uploader` с `accept = \`${PHOTO_ACCEPT},application/pdf,.pdf\``, `max={5}`, `usePhotoUploads("REQUEST_DESIGN", …)`;
  - `Checkbox name="designContactsConfirmed"` показывается, когда есть хотя бы один файл.
- Modify: `src/app/(app)/v2/requests/[id]/_parts/card-view.ts`, `RequestCardView.tsx` (секция «Дизайн-проект»: фото — галереей, PDF — строками-ссылками; скрытый — `StatusChip` «Скрыт оператором»)
- Modify: `src/i18n/ru/app/requests.ts`:
  - `wizard.room.design.title`: «Свой дизайн-проект»;
  - `hint`: «Если есть готовый проект — приложите план в PDF или фото. Мастер увидит его в заявке»;
  - `confirm`: «Я убрал из файлов телефоны, адреса и имена»;
  - `pdf: (n) => \`Дизайн-проект, файл ${n} (PDF)\``;
  - `hidden`: «Скрыт оператором».
- Test: `src/app/(app)/v2/requests/new/steps.test.ts`, `src/app/(app)/v2/requests/[id]/_parts/card-view.test.ts`, `RequestCardView.test.tsx`

- [ ] **Step 1: Написать падающие тесты.**
  - `readStep("room")` разбирает `designFileIds` и отметку.
  - `stepErrors` без отметки при файлах даёт ошибку `designContactsConfirmed`.
  - Карточка показывает PDF-ссылку с текстом «Дизайн-проект, файл 1 (PDF)» и пометку у скрытого.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Поля ≥ 48 px дают компоненты kit. Главное действие шага не меняется.
- [ ] **Step 4: Запустить** тесты, затем `buyer-words.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): покупатель прикладывает дизайн-проект и видит его в карточке заявки`.

### Task 9: Мастер — входящая заявка и сделка

**Files:**
- Modify: `src/modules/requests/offers.ts` (`getIncomingRequest`: `design: FileView[]` — отдельный `db.storedFile.findMany({ where: { requestId, purpose: "REQUEST_DESIGN", hiddenAt: null }, orderBy: { sortOrder: "asc" }, select: { id, provider, storageKey, contentType } })`: у Prisma нет второго выбора той же связи `photos` под другим именем)
- Modify: `src/modules/deal-core/queries.ts` (в виде сделки — `design: FileView[]`: отдельный `findMany` по `requestId` сделки, `purpose: "REQUEST_DESIGN"`, `hiddenAt: null`; `viewInclude` не трогать)
- Modify: `src/app/(app)/v2/executor/requests/[id]/_parts/request-view.ts`, `src/app/(app)/v2/executor/requests/[id]/page.tsx` (секция «Дизайн-проект» после фото помещения)
- Modify: `src/app/(app)/v2/deals/[id]/_parts/deal-card.ts`, `DealCardView.tsx` (та же секция у обеих сторон)
- Modify: `src/i18n/ru/app/master-requests.ts` и `src/i18n/ru/app/deal.ts` (`design.title`: «Дизайн-проект покупателя» / «Дизайн-проект»)
- Test: `src/modules/requests/offers.int.test.ts`, `request-view.test.ts`, `src/app/(app)/v2/deals/[id]/_parts/deal-card.test.ts` (создать, если нет), `src/modules/deal-core/*.int.test.ts` (где проверяется вид сделки)

- [ ] **Step 1: Написать падающие тесты.**
  - Мастер сегмента видит 2 файла проекта до отклика, скрытый не видит.
  - Вид сделки содержит `design` без скрытых.
  - Секция рендерит ссылку PDF и фото.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.**
- [ ] **Step 4: Запустить** тесты и `master-words.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): мастер видит дизайн-проект во входящей заявке и в сделке`.

### Task 10: Оператор скрывает и возвращает файл

**Files:**
- Create: `src/modules/requests/design-files.ts`, экспорт в `src/modules/requests/index.ts`
- Create: `src/app/(app)/v2/operator/requests/[number]/page.tsx`, `actions.ts`
- Modify: `src/app/(app)/v2/operator/requests/page.tsx` (форма «Открыть заявку №»: `InputField` + `Button`, GET на `/v2/operator/requests/<номер>`)
- Modify: `src/app/(app)/v2/operator/deals/[id]/page.tsx` (ссылка «Файлы заявки»)
- Modify: `src/i18n/ru/app/operator-disputes.ts` (ветка `requestFiles`: `title`, `open`, `hide` «Скрыть», `restore` «Вернуть», `hidden` «Скрыт», `empty` «Покупатель не прикладывал дизайн-проект», `notFound`)
- Test: `src/modules/requests/design-files.int.test.ts`, `src/app/(app)/v2/operator/requests/[number]/page.int.test.ts`

**Interfaces:**
- Produces:
  - `getRequestDesignFiles(user: CurrentUser, requestNumber: number): Promise<{ requestId: string; number: number; files: (FileView & { hidden: boolean })[] }>`. Требует `requireUser("OPERATOR")`-эквивалент модуля; заявки нет → `fail.notFound`.
  - `setRequestFileHidden(user: CurrentUser, input: { fileId: string; hidden: boolean }): Promise<{ changed: boolean }>`:
    - выполняется в `transaction()`;
    - `updateMany({ where: { id, purpose: "REQUEST_DESIGN", hiddenAt: hidden ? null : { not: null } }, data: hidden ? { hiddenAt: now, hiddenById: user.id } : { hiddenAt: null, hiddenById: null } })`;
    - `count === 0` → `{changed:false}` без аудита (повтор); иначе `recordAudit` с `action` `request.design_file_hidden` или `request.design_file_restored`, `entity { type: "request", id: requestId }`, `meta { fileId }`.
  - `setRequestFileHiddenAction = action("app.operator.requestFiles.setHidden", z.strictObject({ fileId: z.string().min(1).max(100), hidden: z.enum(["1","0"]) }), …)`. Первой строкой `requireUser("OPERATOR")`, затем `revalidatePath` страницы.

- [ ] **Step 1: Написать падающие тесты.**
  - Скрытие → `hiddenAt` задан, одна запись аудита.
  - Повтор → `changed:false`, аудит не прибавился.
  - Возврат работает.
  - Покупатель и мастер → FORBIDDEN.
  - Файл `REQUEST_ROOM` → не меняется.
  - Страница оператора показывает файлы, номер не найден → 404.
- [ ] **Step 2: Запустить.** Expected: FAIL.
- [ ] **Step 3: Реализовать.** Страница — `requireOperator(...)`, `DataTable` или `List` из kit. Кнопки — формы с `Button variant="secondary"`, высота kit.
- [ ] **Step 4: Запустить** тесты и `src/app/(app)/v2/operator/queues.int.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): оператор скрывает и возвращает файл дизайн-проекта`.

### Task 11: e2e — дизайн-проект от покупателя до оператора

**Files:**
- Modify: `e2e-v2/buyer-request.spec.ts`, `e2e-v2/master-requests.spec.ts`, `e2e-v2/operator.spec.ts` (или один новый `e2e-v2/design-project.spec.ts` — на выбор исполнителя, с Ruling)
- Create: `e2e-v2/fixtures/design.pdf` (маленький валидный PDF, ≤ 2 КБ)

- [ ] **Step 1: Сценарий.**
  1. Покупатель на шаге «Помещение» прикладывает `design.pdf`. Без отметки — ошибка у отметки; с отметкой — шаг сохранён. Заявка отправлена.
  2. Мастер сегмента открывает входящую заявку и видит «Дизайн-проект, файл 1 (PDF)».
  3. Оператор открывает «Заявка №N» и нажимает «Скрыть».
  4. Мастер больше не видит файл. Покупатель видит «Скрыт оператором».
- [ ] **Step 2: Запустить** по `e2e-v2/README.md`. Expected: PASS.
- [ ] **Step 3: Commit** `test(web): e2e дизайн-проекта в заявке`.

После задачи 11 — полная проверка (`npm run check` с переменными из памяти проекта) и итоговое ревью ветки.
