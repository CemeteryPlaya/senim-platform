# Профили мастеров, приглашение к заказу и профиль покупателя — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** покупатель после публикации заказа открывает список мастеров, смотрит профиль мастера со сделками на площадке и отзывом под каждой, приглашает мастера своей ценовой группы к заказу; мастер принимает (отклик), отказывается с причиной или предлагает свою цену; покупатель решает, что из его оконченной сделки видно в профиле мастера; у покупателя — свой профиль с историей заказов.

**Architecture:** модули `apps/web` (Prisma) и экраны v2 (`@/kit`), как весь редизайн; план 3 (сервис `deal` на Go) перенесёт данные со сделками. Новые таблицы — `DealShowcase` (выбор заказчика), `ExecutorHighlight` (лучшие работы), `RequestInvitation` (приглашения); поля `Request.district`, `Request.complex`. Числа мастера (сделки, доля успешных) считаются запросом по `Deal`; рейтинг и число отзывов — как сейчас, хранятся в `ExecutorProfile` (`recalculateRating`).

**Tech Stack:** Next.js 16 App Router, Prisma 7, zod, vitest (unit + integration на `senim_v2web_test`), Playwright (e2e v2).

**Spec:** `docs/superpowers/specs/2026-11-17-master-profiles-and-history-design.md` (решения владельца и автора 1–16). Разведка: `.superpowers/sdd/2026-11-17-master-profiles/recon-*.md`.

## Global Constraints

- Сервер: каждый вход — zod (`action()`), первой строкой `requireUser(...)`; права на объект — модуль.
- Изменение состояния — в `transaction()` с `recordAudit`/`auditByUser` в той же транзакции; конкурентность — условный `updateMany` + `expectOneUpdated()` или уникальный индекс + `isUniqueViolation`; повтор — `clientKey` (`useClientKey().keyFor`/`done`).
- Деньги — тиыны (`BigInt`, `<Money>`); «уровень» — ценовая группа `Segment` (Эконом, Комфорт, Премиум).
- Контакты до оферты скрыты; имя мастера — по режиму ADR-006 (`executorDisplay*`); тексты покупателя и мастера — через маску (`maskPublicText`, `sanitizeExecutorText`, `maskContacts`).
- Тексты — только `ru`. Сторожа слов: в зонах `master*` нет «заказчик», «клиент», «выплат», «договор»; в общих и мастерских — «комисси», «эскроу», «платформ», «демо», «тестов», «отклик»; в `guest` — «платформ». В текстах для мастера покупатель — «покупатель».
- Экраны — только `@/kit`; сырой `<input>` в экранах запрещён; новый общий компонент — в `src/kit` с тестом и строкой в `docs/design/v3/components.md`.
- Сделка «оконченная» — `SPLIT_PAYOUT | CANCELLED | REFUNDED` **и** `signedAt != null`; сделка без `signedAt` нигде не считается и без отзыва.
- Тестовые базы — только `senim_v2web_test`/`senim_v2web_e2e` (localhost:5442); vitest — из `cd /d/senim-platform && cd apps/web`; e2e — один dev-сервер на `.next-e2e`; порты закрывать после проверки.
- Коммит маленький, Conventional Commits по-русски, тело «почему / что / как проверено», последняя строка `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; пуш — по команде владельца.

## Review Focus

1. **Чужие данные на публичной странице:** без выбора заказчика (и у старых сделок) профиль мастера не показывает фото сдачи, стоимость, адрес и имя — только что делали, месяц, итог, оценку и текст отзыва с инициалом; после отзыва согласия на ПДн (ADR-014) — так же.
2. **Приглашение за пределами правил:** чужой заказ, заказ не OPEN или не тендер, мастер другой ценовой группы, сам себя, повтор, 11-е приглашение — отказ с понятным кодом; приглашение не открывает заказ мастеру другой группы.
3. **Отзыв по сделке, отменённой до оферты** (`signedAt` пуст) — отказ; по оконченной с офертой (успешно, отмена, возврат) — можно, один раз.
4. **Доля успешных** не учитывает идущие сделки и сделки без оферты; нет оконченных — процент не показывается.
5. **Адрес на странице мастера** никогда не содержит улицу и номер дома — только город / район / ЖК по выбору; ЖК без района не показывается.

---

## Группа R. Отзывы и выбор заказчика

### Task R1: отзыв после любого окончания сделки с офертой; флаги по умолчанию включены

**Files:**
- Create: `apps/web/src/modules/deal-core/ended.ts` (`ENDED_DEAL`, `isEndedSigned`)
- Modify: `apps/web/src/modules/deal-core/service.ts` (`assertCanReview`), `next-step.ts` (`FINAL.CANCELLED`, `FINAL.REFUNDED`), `queries.ts:234` и `next-steps.ts:54` (`canReview`), `index.ts`
- Modify: `apps/web/src/platform/env.ts` (`FEATURE_REVIEWS`, `FEATURE_DEAL_PORTFOLIO` — по умолчанию `true`), `apps/web/docs/adr/009-tz-v1-money-model.md` (заметка «Обновление 17.11.2026»)
- Test: `apps/web/src/modules/deal-core/review.int.test.ts` (создать) или существующий тест отзывов; `apps/web/src/platform/env.test.ts`

**Interfaces:**
- Produces: `export const ENDED_DEAL: readonly DealStatus[] = ["SPLIT_PAYOUT", "CANCELLED", "REFUNDED"]`; `export function isEndedSigned(deal: { status: DealStatus; signedAt: Date | null }): boolean`.

- [ ] **Step 1: тесты.** `«отзыв: успешно, отмена после оферты, возврат — можно, один раз»` (три сделки: `SPLIT_PAYOUT`, `CANCELLED` с `signedAt`, `REFUNDED`; повтор — `CONFLICT reviewExists`); `«отмена до оферты (signedAt пуст) — CONFLICT reviewOnlyCompleted, отзыва нет»`; `«идущая сделка — CONFLICT»`; `next-step`: у `CANCELLED`/`REFUNDED` с `signedAt` и без отзыва — действие покупателя `leaveReview`, без `signedAt` — нет. env: без `FEATURE_REVIEWS`/`FEATURE_DEAL_PORTFOLIO` — `features().reviews === true`, `dealPortfolio === true`; `FEATURE_REVIEWS=false` выключает.
- [ ] **Step 2:** тесты падают (`npx vitest run --project integration src/modules/deal-core`, `npx vitest run src/platform/env.test.ts`).
- [ ] **Step 3:** `assertCanReview` — `isEndedSigned(deal)` вместо `status === "SPLIT_PAYOUT"`; `FINAL.CANCELLED`/`FINAL.REFUNDED` — `i.canReview && i.signed ? mine("leaveReview")` (добавить `signed` во вход `next-step`); флаги — `bool(true)`.
- [ ] **Step 4:** тесты проходят; `deal-core` и экраны сделки v2 (`src/app/(app)/v2/deals`) зелёные.
- [ ] **Step 5:** коммит `feat(web): отзыв после любого окончания сделки с офертой; отзывы и портфолио сделок включены`.

### Task R2: выбор заказчика «что показать в профиле мастера» (модуль)

**Files:**
- Modify: `apps/web/prisma/schema.prisma` + миграция `apps/web/prisma/migrations/20261118100000_deal_showcase/migration.sql`
- Create: `apps/web/src/modules/deal-core/showcase.ts`, `apps/web/src/modules/deal-core/showcase.int.test.ts`
- Modify: `apps/web/src/modules/deal-core/schemas.ts` (`showcaseSchema`), `index.ts`
- Modify: место, где решается отзыв согласия ПДн (найти: `resolveRevocationAction` → модуль `identity`/`operator`, исполнение отзыва) — вызвать `closeShowcasesOf(tx, userId)`
- Modify (замена `portfolioConsentAt`, решение автора 5): читатели — `companies/catalog.ts` `VISIBLE_ITEM` (`deal: { showcase: { photos: true } }`), `companies/deal-portfolio.ts` (`applyPortfolioConsent` пишет `DealShowcase.photos`, чтения `:59, 97, 198, 201`), `companies/portfolio.ts:73, 94`; тесты `catalog.int.test.ts`, `deal-portfolio.int.test.ts` — по смыслу. Колонку `Deal.portfolioConsentAt` не удалять в этом релизе (правило README: удаление колонок — отдельным релизом).

**Interfaces:**
- Модель:
  ```prisma
  enum ShowcaseAddress { NONE CITY DISTRICT COMPLEX }
  enum ShowcaseSignature { NAME INITIAL }
  model DealShowcase {
    dealId      String            @id
    deal        Deal              @relation(fields: [dealId], references: [id], onDelete: Cascade)
    photos      Boolean           @default(false)
    price       Boolean           @default(false)
    address     ShowcaseAddress   @default(NONE)
    signature   ShowcaseSignature @default(INITIAL)
    signedAs    String            // снимок подписи: «Айгерим» или «А.»
    textVersion String            // редакция текста вопроса (ru.app.deal.showcase.version)
    updatedAt   DateTime          @updatedAt
    updatedById String
  }
  ```
  Миграция переносит `Deal.portfolioConsentAt IS NOT NULL` → строка `photos = true`, остальное по умолчанию, `signedAs` — инициал из ФИО проекции `User`, `textVersion = '2026-11-18'`.
- Produces: `setDealShowcase(user: CurrentUser, raw: ShowcaseInput): Promise<void>`; `getDealShowcase(user: CurrentUser, dealId: string): Promise<ShowcaseView>`; `closeShowcasesOf(tx: Tx, userId: string): Promise<number>`; `showcaseSchema = z.strictObject({ dealId, photos: z.boolean(), price: z.boolean(), address: z.enum(["NONE","CITY","DISTRICT","COMPLEX"]), signature: z.enum(["NAME","INITIAL"]), clientKey: z.uuid().optional() })`; `type ShowcaseView = { photos; price; address; signature; signedAs; changeable: boolean; addressOptions: ShowcaseAddress[] }` (`addressOptions` — `COMPLEX` только если у заявки есть район и ЖК, `DISTRICT` — если есть район).

- [ ] **Step 1: тесты** (`showcase.int.test.ts`): `«работа из сделки видна в каталоге только при showcase.photos (прежнее согласие перенесено миграцией)»`; `«покупатель оконченной сделки с офертой сохраняет выбор; аудит deal.showcase.changed с прежним и новым»`; `«подпись — снимок имени: NAME → "Айгерим", INITIAL → "А."»` (ФИО «Сапарова Айгерим Маратовна» → имя — второе слово; одно слово — оно же); `«мастер, оператор, чужой — FORBIDDEN/NOT_FOUND; идущая и до оферты — CONFLICT»`; `«COMPLEX без ЖК у заявки и DISTRICT без района — VALIDATION»`; `«повтор с тем же содержимым — одна запись аудита»`; `«closeShowcasesOf: все выборы человека — закрытый вид, подпись — инициал»`; `«без строки — getDealShowcase отдаёт закрытый вид по умолчанию»`.
- [ ] **Step 2:** падают.
- [ ] **Step 3:** реализация; имя — из `identity` (`ownProfile`/проекция `User.fullName` — что доступно серверу без сессии гостя; выбрать проекцию `User`, она обновляется `projectPerson`).
- [ ] **Step 4:** проходят; `deal-core` зелёный.
- [ ] **Step 5:** коммит `feat(web): выбор покупателя — что из сделки видно в профиле мастера`.

### Task A1: район и ЖК в заявке

**Files:**
- Modify: `apps/web/prisma/schema.prisma` (`Request.district String?`, `Request.complex String?`) + миграция `20261118110000_request_district_complex`
- Modify: `apps/web/src/modules/requests/cities.ts` (`DISTRICTS: Readonly<Record<string, readonly string[]>>` — Астана: Алматы, Байконыр, Есиль, Нура, Сарыарка; Алматы: Алатауский, Алмалинский, Ауэзовский, Бостандыкский, Жетысуский, Медеуский, Наурызбайский, Турксибский), `schema.ts` (`placeStep`: `district: z.string().trim().max(60).nullable()`, `complex: z.string().trim().max(80).nullable()`, refine: ЖК без района — ошибка у `complex`), `drafts.ts` (`fieldsOf`, маска `complex` через `maskContacts`, `getDraft`/`getClientRequest` отдают поля)
- Modify: `apps/web/src/app/(app)/v2/requests/new/WizardPlace.tsx` (район: `Select` по `DISTRICTS[city]` или `TextField`, если списка нет; ЖК — `TextField`, необязательно), `steps.ts` (`readStep`, `stepErrors`, сводка «Город, район, ЖК, адрес»), `PlaceInitial`
- Modify: `apps/web/src/i18n/ru/app/requests.ts` (подписи, подсказки, ошибка «Сначала укажите район»)
- Test: `apps/web/src/modules/requests/drafts.int.test.ts`, `apps/web/src/app/(app)/v2/requests/new/steps.test.ts`

- [ ] **Step 1: тесты:** `«шаг адреса сохраняет район и ЖК; ЖК без района — VALIDATION у complex»`; `«ЖК с телефоном — маска»`; `«readStep(place) читает district/complex; сводка — "Астана, Есиль, ЖК Highvill, ул. …"»`; `«DISTRICTS: у Астаны 5 районов, у другого города списка нет»`.
- [ ] **Step 2–4:** падают → реализация → проходят (+ `src/app/(app)/v2/requests` зелёный).
- [ ] **Step 5:** коммит `feat(web): район и ЖК на шаге адреса заявки`.

### Task R3: выбор показа на экранах покупателя

**Files:**
- Create: `apps/web/src/app/(app)/v2/deals/[id]/showcase/page.tsx`, `_parts/ShowcaseForm.tsx`, `actions.ts`, тесты `showcase.int.test.ts`
- Modify: `apps/web/src/app/(app)/v2/deals/[id]/review/ReviewForm.tsx` + `actions.ts` (под оценкой — тот же выбор; одна отправка пишет отзыв и выбор), `apps/web/src/app/(app)/v2/deals/[id]/_parts/deal-card.ts` + `DealCardView.tsx` (у оконченной сделки покупателя — строка «Показ в профиле мастера: …» со ссылкой «Изменить» на `/showcase`)
- Modify: `apps/web/src/i18n/ru/app/deal.ts` (`showcase`: заголовок «Показать сделку в профиле мастера?», пояснение, «Фото из отчёта сдачи», «Стоимость сделки», «Адрес»: «Не показывать», «Город», «Город и район», «Город, район и ЖК», «Как подписать отзыв»: имя / инициал, «Сохранить», тост, `version`)

- [ ] **Step 1: тесты:** действие `saveShowcaseAction` — покупатель сохраняет, мастер — FORBIDDEN; варианты адреса на форме — только доступные (`addressOptions`); отзыв с выбором — одна отправка, повтор с тем же ключом — без второй записи; карточка оконченной сделки покупателя показывает текущий выбор одной строкой.
- [ ] **Step 2–4:** падают → реализация (`RadioGroup`/`RadioCard`, `Checkbox`, `ActionDock`, `useClientKey`) → проходят.
- [ ] **Step 5:** коммит `feat(web): покупатель выбирает, что из сделки видно в профиле мастера`.

---

## Группа P. Профиль мастера

### Task P1: числа мастера

**Files:**
- Create: `apps/web/src/modules/deal-core/executor-stats.ts`, тест `executor-stats.int.test.ts`
- Modify: `apps/web/src/modules/deal-core/index.ts`

**Interfaces:**
- Produces: `executorStats(executorIds: readonly string[]): Promise<Map<string, ExecutorStats>>`; `type ExecutorStats = { deals: number; ended: number; successful: number; successRate: number | null }` (`deals` — `signedAt` есть; `ended`/`successful` — по `ENDED_DEAL` с `signedAt`; `successRate = ended ? Math.round(successful / ended * 100) : null`).

- [ ] **Step 1: тесты:** набор сделок мастера (идущая с офертой, успешная, отмена с офертой, возврат, отмена без оферты) → `deals 4, ended 3, successful 1, successRate 33`; без оконченных — `successRate null`; несколько мастеров одним запросом.
- [ ] **Step 2–5:** падают → `groupBy` по `executorId, status` с `signedAt: { not: null }` → проходят → коммит `feat(web): число сделок и доля успешных у мастера`.

### Task P2: сделки мастера на площадке для публичной страницы

**Files:**
- Create: `apps/web/src/modules/deal-core/deal-history.ts`, тест `deal-history.int.test.ts`
- Modify: `apps/web/src/modules/deal-core/index.ts`

**Interfaces:**
- Consumes: `DealShowcase` (R2), `Request.district`/`complex` (A1), `previewUrl` (files).
- Produces: `listExecutorDealHistory(executorId: string, opts?: { limit?: number }): Promise<DealHistoryItem[]>`; 
  ```ts
  type DealHistoryItem = {
    id: string; title: string; segment: Segment | null; endedAt: Date;
    outcome: "success" | "failed";            // SPLIT_PAYOUT — success; CANCELLED, REFUNDED — failed
    photos: { id: string; src: string; alt: string }[];  // только при showcase.photos; previewUrl, expiresInSec 3600
    priceTiyn: bigint | null;                 // только при showcase.price
    place: string | null;                     // по showcase.address из Request.city/district/complex; NONE — null
    review: { rating: number; text: string; signedAs: string; createdAt: Date } | null; // text — maskPublicText; signedAs — снимок или инициал по умолчанию
  };
  ```
  Только оконченные с `signedAt`, новые выше (`endedAt` = время перехода в конечный статус; если поля нет — `updatedAt`), лимит по умолчанию 20; мастер должен быть виден (`VISIBLE_EXECUTOR`).

- [ ] **Step 1: тесты:** без выбора — нет фото, стоимости, места, подпись — инициал автора; выбор «фото, цена, город+район+ЖК, имя» — всё есть; адрес никогда не содержит `Request.address`; идущая и без оферты — не в списке; отзыв с телефоном — маска; фото — превью, по одной подписанной ссылке на снимок.
- [ ] **Step 2–5:** падают → реализация → проходят → коммит `feat(web): сделки мастера на площадке с отзывом — для публичной страницы`.

### Task P3: лучшие работы мастера (модуль)

**Files:**
- Modify: `schema.prisma` + миграция `20261118120000_executor_highlight`:
  ```prisma
  model ExecutorHighlight {
    id              String         @id @default(cuid())
    executorId      String
    executor        ExecutorProfile @relation(fields: [executorId], references: [id], onDelete: Cascade)
    portfolioItemId String?        @unique
    dealId          String?        @unique
    position        Int
    @@unique([executorId, position])
  }
  ```
  (CHECK: ровно одно из `portfolioItemId`, `dealId` — в SQL миграции.)
- Create: `apps/web/src/modules/companies/highlights.ts`, тест `highlights.int.test.ts`; Modify: `companies/index.ts`

**Interfaces:**
- Produces: `setHighlights(user: CurrentUser, raw: { items: ({ kind: "work"; id: string } | { kind: "deal"; id: string })[] }): Promise<void>` (мастер; ≤ 6; работа — своя опубликованная без `dealId`; сделка — своя оконченная с офертой и выбором «фото: да»; заменяет набор целиком в транзакции; аудит `executor.highlights.changed`); `listHighlightCandidates(user): Promise<HighlightCandidate[]>`; `publicHighlights(executorId): Promise<HighlightCard[]>` (`HighlightCard = { kind; id; title; photo: { src; alt } | null; href: string | null }`; сделка, у которой заказчик снял «фото», из витрины выпадает).

- [ ] **Step 1: тесты:** 7 — VALIDATION; чужая работа/сделка — NOT_FOUND; сделка без «фото: да» — VALIDATION; порядок сохраняется; снятое «фото» убирает сделку из `publicHighlights`.
- [ ] **Step 2–5:** падают → реализация → проходят → коммит `feat(web): лучшие работы мастера — модуль`.

### Task P4: публичная страница мастера v2

**Files:**
- Modify: `apps/web/src/modules/companies/catalog.ts` (`getPublicExecutorPage` → `{ view, about, stats, highlights, dealHistory, offPlatform }`; `offPlatform` — работы без `dealId`; отдельный блок отзывов убирается), `types.ts`
- Modify: `apps/web/src/app/(app)/v2/executors/[publicNumber]/page.tsx`, `_parts/executor-view.ts` (+ тест), удалить `Reviews`
- Modify: `apps/web/src/i18n/ru/app/guest.ts` (`executor`: «Лучшие работы», «Сделки на площадке», «Работы вне площадки», «завершена», «не состоялась», «Сделок», «Успешных», «пока нет завершённых сделок», подпись отзыва)

- [ ] **Step 1: тесты** (`executor-view.test.ts`, `page.int.test.ts`): шапка — рейтинг, отзывы, сделки, «Успешных 93%» или «пока нет завершённых сделок»; «Сделки на площадке» — по одной карточке на сделку, отзыв внизу своей сделки с подписью; «Работы вне площадки» — без работ из сделок, с пометкой; отдельного раздела отзывов нет; имя мастера — по ADR-006.
- [ ] **Step 2–5:** падают → реализация (`Stat`/`StatRow`, `PhotoGallery strip`, `Card`, `WorkCard`) → проходят → коммит `feat(web): профиль мастера — сделки с отзывом под каждой, лучшие работы, работы вне площадки`.

### Task P5: мастер выбирает лучшие работы (экран)

**Files:**
- Create: `apps/web/src/app/(app)/v2/executor/portfolio/best/page.tsx`, `_parts/BestForm.tsx`, `actions.ts`, тест
- Modify: `apps/web/src/app/(app)/v2/executor/portfolio/page.tsx` (ссылка «Лучшие работы: N из 6»), `apps/web/src/i18n/ru/app/master-portfolio.ts`

- [ ] **Step 1: тесты:** список кандидатов (работы и сделки с разрешёнными фото), отметка до 6 (седьмая — недоступна с подсказкой), порядок стрелками (как типы мебели у оператора), сохранение — тост; сделка без разрешения фото — в кандидатах нет, с подсказкой «покупатель не разрешил показывать фото».
- [ ] **Step 2–5:** падают → реализация (`Checkbox`, кнопки порядка) → проходят → коммит `feat(web): мастер выбирает лучшие работы`.

---

## Группа L. Список мастеров

### Task L1: общий список мастеров

**Files:**
- Create: `apps/web/src/modules/companies/executors-list.ts`, тест; `apps/web/src/app/(app)/v2/executors/page.tsx`, `_parts/list-view.ts` (+ тест)
- Modify: `apps/web/src/app/(app)/v2/requests/[id]/_parts/card-view.ts` (`nowView`: для OPEN + TENDER + путь TZ — второстепенное действие «Посмотреть мастеров» → `/v2/executors?request=<id>`), `RequestCardView.tsx`
- Modify: `apps/web/src/i18n/ru/app/guest.ts` (`executors`: заголовок «Мастера», пусто, «Сделок», «Успешных») и `requests.ts` (кнопка)

**Interfaces:**
- Produces: `listExecutors(opts: { page: number; perPage?: number }): Promise<{ items: ExecutorListItem[]; total: number }>`; `ExecutorListItem = { publicNumber; label; segment; ratingAvg; reviewsCount; stats: ExecutorStats; cover: { src; alt } | null }` — `VISIBLE_EXECUTOR`, порядок: есть отзывы выше, затем `ratingAvg desc`, затем `stats.successful desc`, затем `publicNumber`; `cover` — первая лучшая работа, иначе последняя опубликованная работа вне площадки.

- [ ] **Step 1: тесты:** порядок по правилу; заблокированный и неодобренный — нет; карточка — число сделок и доля; `?request=` чужой/не OPEN — список без кнопок приглашения (без ошибки); кнопка на карточке заявки только для OPEN + TENDER + TZ.
- [ ] **Step 2–5:** падают → реализация (`Pagination`, `ListRow`/карточка с фото) → проходят → коммит `feat(web): общий список мастеров и кнопка «Посмотреть мастеров» у заказа`.

---

## Группа I. Приглашение мастера к заказу

### Task I1: приглашения (модуль)

**Files:**
- Modify: `schema.prisma` + миграция `20261118130000_request_invitation`:
  ```prisma
  enum InvitationStatus { INVITED DECLINED OFFERED }
  model RequestInvitation {
    id         String           @id @default(cuid())
    requestId  String
    request    Request          @relation(fields: [requestId], references: [id], onDelete: Cascade)
    executorId String
    executor   ExecutorProfile  @relation(fields: [executorId], references: [id], onDelete: Cascade)
    status     InvitationStatus @default(INVITED)
    reason     String?
    clientKey  String?
    createdAt  DateTime         @default(now())
    decidedAt  DateTime?
    @@unique([requestId, executorId])
    @@index([executorId, status])
  }
  ```
- Create: `apps/web/src/modules/requests/invitations.ts`, тест `invitations.int.test.ts`; Modify: `requests/schema.ts`, `requests/index.ts`, `requests/offers.ts` (`sendOffer`: приглашение этого мастера → `OFFERED` в той же транзакции; `listIncomingRequests`/`getIncomingRequest`: признак `invited`), `requests/transitions.ts` (таблица `INVITATION_TRANSITIONS`: INVITED→DECLINED (EXECUTOR), INVITED→OFFERED (система при отклике))
- Modify: `apps/web/src/modules/notifications/templates.ts` (виды `request.invited` мастеру — со SMS; `request.invitation_declined` покупателю — без SMS)

**Interfaces:**
- Produces: `inviteExecutor(user, raw: { requestId: string; publicNumber: number; clientKey?: string }): Promise<{ invitationId: string; created: boolean }>`; `declineInvitation(user, raw: { requestId: string; reason: string }): Promise<void>`; `listInvitations(user, requestId): Promise<InvitationView[]>` (`InvitationView = { publicNumber; label; status; reason: string | null; createdAt }`); `INVITATIONS_PER_REQUEST = 10`.
- Правила `inviteExecutor`: покупатель — своя заявка; `status === "OPEN"`, `mode === "TENDER"`, путь TZ; мастер виден и `segment === request.segment`, иначе `VALIDATION` с кодом `otherSegment`; не сам себе; уже приглашён — тот же ответ (`created: false`); 11-й — `CONFLICT invitationsLimit`; уведомление мастеру и аудит `request.invitation.sent` в транзакции.
- Правила `declineInvitation`: мастер приглашён и `INVITED`; причина 3..300 знаков, через маску контактов; `DECLINED`, `decidedAt`; уведомление покупателю; аудит `request.invitation.declined`; отказ окончателен (повтор — `CONFLICT`).

- [ ] **Step 1: тесты** — по одному на каждое правило выше (Review Focus 2), плюс: отклик приглашённого мастера переводит приглашение в `OFFERED`; приглашение не меняет видимость: мастер другой группы не видит заказ даже после отказа в приглашении; одновременные два приглашения одного мастера — одна запись.
- [ ] **Step 2–5:** падают → реализация → проходят (`requests` зелёный) → коммит `feat(web): приглашение мастера к заказу — модуль`.

### Task I2: приглашения на экранах

**Files:**
- Modify: `apps/web/src/app/(app)/v2/executors/[publicNumber]/page.tsx` (кнопка «Пригласить к заказу №N» при `?request=` своего подходящего заказа; иначе у покупателя с подходящими заказами — выбор заказа в шторке; мастер другой группы — строка «Работает в другой ценовой группе»), `actions.ts` (создать, `inviteExecutorAction`)
- Modify: `apps/web/src/app/(app)/v2/requests/[id]/_parts/RequestCardView.tsx`, `card-view.ts` (раздел «Приглашённые мастера»: мастер, статус «Ждём ответа» / «Отказался: <причина>» / «Прислал предложение»)
- Modify: `apps/web/src/app/(app)/v2/executor/_parts/incoming-view.ts` (бейдж «Вас пригласили», accent), `apps/web/src/app/(app)/v2/executor/requests/[id]/page.tsx` + `_parts/request-view.ts` (метка в заголовке; действие «Отказаться от приглашения» — шторка с причиной; «Предложить свою цену» — обычный отклик)
- Modify: `apps/web/src/i18n/ru/app/master-requests.ts`, `master-offer.ts`, `requests.ts`, `guest.ts`

- [ ] **Step 1: тесты:** DOM/int — кнопка приглашения есть только при подходящем заказе и мастере той же группы; повтор нажатия — одно приглашение (`clientKey`); у мастера во входящих бейдж и отказ с причиной (пустая/короткая — ошибка у поля); у покупателя на карточке заказа — список приглашённых со статусами и причиной отказа.
- [ ] **Step 2–5:** падают → реализация → проходят → коммит `feat(web): приглашение мастера к заказу на экранах покупателя и мастера`.

---

## Группа H. Профиль покупателя

### Task H1: история заказов покупателя (модуль)

**Files:**
- Create: `apps/web/src/modules/requests/buyer-history.ts`, тест `buyer-history.int.test.ts`; Modify: `requests/index.ts`

**Interfaces:**
- Produces: `buyerHistory(user: CurrentUser): Promise<BuyerHistory>`; `BuyerHistory = { counts: { orders: number; deals: number; successful: number }; rows: BuyerHistoryRow[] }`; `BuyerHistoryRow = { requestId; title; executorLabel: string | null; priceTiyn: bigint | null; state: "success" | "cancelled" | "failed" | "progress"; href: string; at: Date }`.
- Правила: заказы — заявки покупателя кроме `DRAFT`; сделки — с `signedAt`; успешные — `SPLIT_PAYOUT`. Статус строки: есть сделка с `signedAt` → по сделке (`SPLIT_PAYOUT` success, `CANCELLED` cancelled, `REFUNDED` failed, иначе progress); сделка без `signedAt` в `CANCELLED` или заявка `CANCELLED` → cancelled; иначе progress. `href` — сделка (`/deals/<id>`) или заявка (`/requests/<id>`), v1-путь для `v2Href`. Новые выше.

- [ ] **Step 1: тесты:** каждый статус строки; счётчики; черновик не входит; чужие заявки не видны; мастер без роли покупателя — FORBIDDEN.
- [ ] **Step 2–5:** падают → реализация → проходят → коммит `feat(web): история заказов покупателя — модуль`.

### Task H2: профиль покупателя (экран) и «Вопросы и ответы»

**Files:**
- Create: `apps/web/src/kit/Disclosure.tsx` (`<details>`/`<summary>` с шевроном, как `GuestLanding` `Help`; `DisclosureList` для нескольких вопросов) + тест; строка в `docs/design/v3/components.md`
- Modify: `apps/web/src/app/(app)/v2/profile/(main)/page.tsx`, `_parts/profile-view.ts` (+ тест), `ProfileView.tsx` — у покупателя: ФИО, `StatRow` (заказов, сделок, успешно), «История заказов» (`ListRow` → `v2Href(row.href)`, статус `StatusChip`: success — accent, failed — danger, cancelled — neutral, progress — warn), внизу `DisclosureList` «Вопросы и ответы» с «Как считаются статусы»
- Modify: `apps/web/src/i18n/ru/app/profile.ts` (`history`: заголовки, статусы «Успешно», «Отменено», «Заказ не выполнен», «В процессе», тексты ответов)

- [ ] **Step 1: тесты:** `Disclosure` — закрыт по умолчанию, `summary` — кнопка с клавиатуры, содержимое в разметке; профиль покупателя — счётчики, строки в порядке модуля, ссылки ведут в v2, раскрывающийся ответ про статусы; у мастера — прежний вид профиля.
- [ ] **Step 2–5:** падают → реализация → проходят → коммит `feat(web): профиль покупателя — счётчики, история заказов, вопросы и ответы`.

---

## Группа F. Завершение

### Task F1: e2e, проверки, документы

- [ ] e2e v2 (flows): покупатель публикует заказ → «Посмотреть мастеров» → профиль мастера своей группы → «Пригласить» → мастер видит «Вас пригласили» → отказывается с причиной → покупатель видит причину; второй мастер приглашён → отклик → приглашение «Прислал предложение».
- [ ] e2e v2 (flows): оконченная сделка сида → отзыв с выбором «фото, город и район, имя» → публичная страница мастера показывает сделку с фото, местом и «Айгерим»; смена выбора на закрытый — фото и место исчезают, подпись — «А.».
- [ ] e2e v2 (чтение): профиль покупателя сида — счётчики и история; страница мастера без входа — без адреса улицы, с долей успешных.
- [ ] Полный `npm run check`, пересев, e2e v2 (чтение и flows), e2e v1 (не сломан); `docs/PROGRESS.md` — раздел функции; ADR-009 — отметка о флагах; `docs/design/v3/components.md`.
- [ ] Итоговое ревью ветки (Opus), правки одним заходом; слияние в `main` без пуша; стенд пересобрать.
