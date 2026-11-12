# Новый интерфейс, этап 1 «Основа» — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** рядом со старым интерфейсом (v1) появляется каркас нового (v2) под `/v2`: токены двух тем, шрифт, базовые компоненты, две оболочки (телефон, компьютер), витрина компонентов, тесты-сторожа и скрипт скриншотов — всё, из чего этапы 2–6 собирают экраны.

**Architecture:** маршруты делятся на две группы с отдельными корневыми layout: `src/app/(legacy)/` — весь v1 без изменений поведения, `src/app/(app)/v2/` — новый интерфейс. Новые компоненты живут в `src/kit/` со своим `tokens.css` (свой `@theme`), старый `src/ui/` не трогается. Версию (телефон или компьютер) выбирает сервер по заголовкам запроса, тему — кука и `prefers-color-scheme`.

**Tech Stack:** Next.js 16.4.3 (App Router, `proxy.ts`), React 19.3, Tailwind 4, vitest, Playwright; новые зависимости — `motion`, `radix-ui`, `vaul`, `sonner`.

**Spec:** `docs/superpowers/specs/2026-11-12-frontend-redesign-design.md` — исполнитель читает разделы 4, 5, 6, 10, 12 перед задачей.

## Global Constraints

- Все пути ниже — от `apps/web/`, если не сказано иное. Команды запускаются из `apps/web` (через `--prefix` vitest ломается).
- Ветка `frontend-v2`, без worktree. Коммиты маленькие, Conventional Commits на русском, тело «почему / что / как проверено», в конце строка `Co-Authored-By` модели-исполнителя. Пуш не делать.
- v1 не меняет поведения: адреса, тексты, тесты v1 остаются зелёными. Старый `src/ui/` не править.
- Код v2 (`src/kit/**`, `src/app/(app)/**`) не импортирует `@/ui` и `@/app/(legacy)`.
- Тексты — только русские, только из `ru` (новая зона `ru.app`, файлы в `src/i18n/ru/app/`). В разметке строк нет. Слов «демо», «комиссия», «эскроу» в `ru.app` нет.
- Название продукта — только из `src/config/brand.ts`.
- Цвета, радиусы, размеры текста, тени — только токены `src/kit/tokens.css`. Вес шрифта не выше 600. Сырые hex и произвольные значения Tailwind (`text-[...]`, `rounded-[...]`, `bg-[#...]`) в `.tsx` запрещены.
- Размеры из спеки: основной текст 17 px (1,0625rem), межстрочный 1,45; вторичный 15 px; мелкий 13 px; заголовок экрана 28 px (телефон) и 32 px (компьютер), трекинг −0,025em, межстрочный 1,1; заголовок раздела 20 px, −0,02em; контролы 48 px; радиусы: карточка 18, кнопка 14 (телефон) и 12 (компьютер), поле 12, чип 6, панель вкладок 22, шторка 24 px.
- Анимируются только `transform` и `opacity`. `prefers-reduced-motion` — короткое проявление вместо сдвигов; `prefers-reduced-transparency` — сплошной фон вместо `backdrop-filter`.
- Без `any`; `@ts-expect-error` только с описанием. Без `console.log` — `logger`.
- Next.js 16 отличается от привычного: перед работой с layout, route groups, `proxy.ts`, `cookies()`/`headers()` читать `node_modules/next/dist/docs/`. API `motion`, `radix-ui`, `vaul`, `sonner` сверять по документации установленной версии (Context7, если доступен; иначе README и типы в `node_modules`).
- Версии новых зависимостей — последние стабильные на момент установки; записать в журнал строкой `Ruling`.
- Хуки запрещают пути и команды с подстрокой «точка + env» и чтение `.pem`/`.key`. Переменные — в командной строке.

### Порты и фоновые процессы (обязательно в каждом брифе)

- Разрешён один dev-сервер на `3110` и стенд из `identity` + `mesh`. Не занимать `3000`, `3100`, `5440`, `5442`. База — только `senim_v2web_e2e` на `localhost:5442` (контейнер `senim-pg`; не запускать `npm run db:up`).
- Поднять стенд (из корня репозитория): `docker compose -f deploy/compose/compose.yaml --env-file deploy/compose/dev.vars --profile core up -d --wait identity mesh`. Остановить: `npm run v2:down`.
- Dev-сервер (из `apps/web`): `DATABASE_URL=postgresql://…/senim_v2web_e2e APP_ENV=dev APP_URL=http://localhost:3110 NEXT_DIST_DIR=.next-e2e DEMO_MODE=true SMS_PROVIDER=mock SIGNATURE_PROVIDER=mock PAYMENT_PROVIDER=manual V2_ENABLED=true MESH_URL=https://localhost:9443 MESH_TLS_CERT_FILE=../../deploy/compose/certs/web.pem MESH_TLS_KEY_FILE=../../deploy/compose/certs/web-key.pem MESH_TLS_CA_FILE=../../deploy/compose/certs/ca.pem npx next dev -p 3110` (строку подключения к базе взять из `e2e/v2.vars.example` и памяти проекта; `DEMO_MODE` пока нужен v1 — уйдёт на этапе 5).
- После проверки убить процесс на `3110` и остановить стенд. В отчёте — строка «Порты: свободны» с выводом проверки порта.
- Задачи идут строго по одной.

## Harness

Журнал: `.superpowers/sdd/2026-11-12-frontend-01-foundation/progress.md` (корень репозитория). Автор заводит его до задачи 1 и пишет в него после каждой задачи: статус, коммит, замечания ревью, строки `Ruling: … — цена`.

Цикл задачи:

1. **Бриф исполнителю** (модель указана у задачи): текст задачи целиком + разделы «Global Constraints» и «Порты» + пути спеки и `docs/design/v3/`.
2. Исполнитель: тест → код → `npm run check` → коммит → отчёт (что сделано, вывод проверок, отклонения от брифа, «Порты: свободны»).
3. **Скриншоты** (с задачи 9): `npx tsx scripts/shots.ts <маршруты>` при поднятом сервере.
4. **Ревью кода** (Opus 5.5, свежий контекст): получает дифф задачи, текст задачи, Global Constraints, спеку. Отвечает списком «блокирует / стоит поправить / мелочь», каждое с файлом и строкой. Проверяет в первую очередь Review Focus.
5. **Ревью вида** (Opus 5.5, свежий контекст; с задачи 9): получает только скриншоты, `docs/design/v3/rules.md`, `checklist.md` и эталоны. Дифф не читает. Тот же формат ответа.
6. Замечания «блокирует» и «стоит поправить» — тому же исполнителю (SendMessage), максимум три круга. Не сошлось — автор пишет план отладки (симптом, гипотезы по убыванию вероятности, проверка каждой, критерий «исправлено») и выдаёт его новой задачей свежему исполнителю на Opus.
7. Запись в журнал, следующая задача.

## Review Focus

1. **Планшет и iPad.** Android-планшет (`Android` без `Mobile` в User-Agent) должен получить мобильную версию; iPad Safari представляется как Mac и получит компьютерную — это известное ограничение, оно должно быть записано в комментарии и тесте, а не оказаться сюрпризом. → задача 3.
2. **Нет заголовков устройства** (бот, curl, старый браузер): версия по умолчанию — компьютерная, страница не падает. → задача 3.
3. **Мусор в куке темы** (`theme=<script>`, пустая, неизвестное значение): трактуется как «как в системе», в разметку не попадает. → задача 2.
4. **Увеличенный шрифт 200%** на телефоне 360 px: панель вкладок и кнопки не обрезают подписи, нет горизонтальной прокрутки страницы. → задача 10.
5. **Клавиатура и фокус в шторке и диалоге:** Tab не уходит под затемнение, Esc закрывает, фокус возвращается на открывшую кнопку; при `prefers-reduced-motion` шторка открывается без сдвига. → задачи 6 и 10.

---

## Структура файлов

```
src/app/(legacy)/            весь v1: layout.tsx, globals.css, page.tsx, _shell, _components, _home, все разделы
src/app/(app)/layout.tsx     корневой layout v2: тема, устройство, шрифт, оболочка
src/app/(app)/app.css        tailwind + src/kit/tokens.css + базовые стили v2
src/app/(app)/_shell/        nav.ts, paths.ts, MobileShell.tsx, DesktopShell.tsx, theme-actions.ts
src/app/(app)/v2/page.tsx    временная главная v2
src/app/(app)/v2/ui-kit/     витрина компонентов (только APP_ENV=dev)
src/app/(app)/v2/[...rest]/  заглушка «раздел переносится»
src/app/api, manifest.ts, icon.svg, apple-icon.png, offline/   остаются на месте
src/kit/                     tokens.css, tokens.ts, fonts.ts, theme.ts, cn.ts, компоненты, index.ts, тесты
src/platform/device.ts       определение устройства
src/i18n/ru/app/             shell.ts, kit.ts; сборка в ru.app
scripts/shots.ts             скриншоты маршрутов
e2e-v2/                      e2e нового интерфейса
docs/design/v3/              (корень репозитория) reference/, rules.md, checklist.md, components.md
```

---

### Task 0: Подготовка (автор, без субагента)

**Files:**
- Create (корень): `docs/design/v3/reference/{visual-style,desktop-layout,mobile,hints}.html`, `docs/design/v3/rules.md`, `docs/design/v3/checklist.md`, `.superpowers/sdd/2026-11-12-frontend-01-foundation/progress.md`
- Modify (корень): `CLAUDE.md` — убрать пункт 3 про `git subtree pull`

- [ ] **Step 1:** `git switch -c frontend-v2` от `main`.
- [ ] **Step 2:** скопировать четыре наброска из `.superpowers/brainstorm/1847-1794484403/content/` в `docs/design/v3/reference/`; в начале `rules.md` указать, какой вариант в каждом файле выбран (стиль B, меню сверху, подсказки 1, 2, 3, 4, 6).
- [ ] **Step 3:** написать `rules.md` — разделы 4–6 спеки в виде пар «можно / нельзя» с точными значениями; `checklist.md` — что проверяет ревьюер вида (одно главное действие; первая карточка отвечает «что сейчас»; нет цветных кружков, рамок 2 px, веса выше 600, рисованных картинок; отступы по шкале; обе темы читаемы; телефон: главная кнопка внизу, панель не перекрывает содержимое; компьютер: содержимое по центру ≤ 1100 px).
- [ ] **Step 4:** завести журнал, убрать пункт 3 из `CLAUDE.md`, коммит `docs: правила дизайна v3 и журнал этапа 1`.

---

### Task 1: Две группы маршрутов (Opus 5.5)

**Files:**
- Move: всё из `src/app/` кроме `api/`, `manifest.ts`, `icon.svg`, `apple-icon.png`, `offline/` → `src/app/(legacy)/` (`git mv`)
- Modify: все импорты `@/app/<x>` → `@/app/(legacy)/<x>` (кроме `@/app/api`), пути в тестах и скриптах, читающих `src/app`
- Create: `src/app/(app)/layout.tsx`, `src/app/(app)/app.css`, `src/app/(app)/v2/page.tsx`, `src/app/(app)/v2/[...rest]/page.tsx`, `src/app/(app)/_shell/paths.ts`, `src/app/(app)/_shell/paths.test.ts`, `src/i18n/ru/app/shell.ts`, `src/i18n/ru/app/index.ts`
- Modify: `src/i18n/ru.ts` (добавить `app`)

**Interfaces:**
- Produces: `to(path: string): string` и `legacy(path: string): string` из `@/app/(app)/_shell/paths`; `ru.app.shell.movingTitle`, `ru.app.shell.movingBody`, `ru.app.shell.openOld`.

- [ ] **Step 1: тест `paths.test.ts`**

```ts
expect(to("/")).toBe("/v2");
expect(to("/deals/42")).toBe("/v2/deals/42");
expect(to("deals")).toBe("/v2/deals");
expect(legacy("/v2/deals/42")).toBe("/deals/42");
expect(legacy("/v2")).toBe("/");
```

- [ ] **Step 2:** запустить `npx vitest run --project unit "src/app/(app)/_shell/paths.test.ts"` — падает: модуля нет.
- [ ] **Step 3:** реализовать `paths.ts` с одной константой `BASE = "/v2"` (на этапе 6 она станет пустой строкой).
- [ ] **Step 4:** перенести v1 в `(legacy)` и поправить импорты. Корневого `src/app/layout.tsx` после этого нет: у каждой группы свой корневой layout с `<html>` и `<body>`. Как в Next 16 устроены несколько корневых layout, `not-found`, `error`, `global-error` при группах — прочитать в `node_modules/next/dist/docs/` и разложить файлы так, чтобы 404 и ошибки v1 выглядели как раньше.
- [ ] **Step 5:** `(app)/layout.tsx` — минимальный: `<html lang="ru">`, `<body>`, импорт `app.css` (пока только `@import "tailwindcss"`), `metadata` с названием из `ru.common.brand`. `v2/page.tsx` — заголовок с названием продукта. `v2/[...rest]/page.tsx` — заглушка: заголовок `ru.app.shell.movingTitle`, текст `movingBody`, ссылка `openOld` на `legacy(текущий путь)`.
- [ ] **Step 6:** `npm run check` — зелёный. Затем поднять стенд и сервер и прогнать `npx playwright test e2e/smoke.spec.ts e2e/30-shell.spec.ts e2e/01-login.spec.ts` — зелёные (v1 не сломан). Открыть `/v2` и `/v2/deals/1`: 200, заглушка ведёт на `/deals/1`. Закрыть сервер и стенд.
- [ ] **Step 7:** коммит `refactor(web): v1 в группе (legacy), каркас v2 под /v2`.

---

### Task 2: Токены, темы, шрифт (Opus 5.5)

**Files:**
- Create: `src/kit/tokens.ts`, `src/kit/tokens.css`, `src/kit/tokens.test.ts`, `src/kit/contrast.test.ts`, `src/kit/fonts.ts`, `src/kit/theme.ts`, `src/kit/theme.test.ts`, `src/kit/cn.ts`
- Modify: `src/app/(app)/app.css`, `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces:
  - `TOKENS: { light: Record<ColorRole, string>; dark: Record<ColorRole, string> }`, где `ColorRole = "canvas" | "surface" | "raised" | "ink" | "muted" | "line" | "action" | "on-action" | "accent" | "accent-soft" | "danger" | "danger-soft" | "warn" | "warn-soft" | "focus"`;
  - утилиты Tailwind по этим ролям (`bg-canvas`, `text-ink`, `text-muted`, `border-line`, `bg-action`, `text-on-action`, `text-accent`, `bg-accent-soft`…), размеры `text-body`, `text-sub`, `text-small`, `text-title`, `text-section`, `text-card`, радиусы `rounded-card`, `rounded-control`, `rounded-field`, `rounded-chip`, `rounded-bar`, `rounded-sheet`, тени `shadow-float`, `shadow-sheet`;
  - `type Theme = "system" | "light" | "dark"`; `parseTheme(raw: string | undefined): Theme`; `getTheme(): Promise<Theme>` (читает куку `theme`); `THEME_COOKIE = "theme"`;
  - `fontVariables: string` (Inter, подмножества `latin`, `cyrillic`);
  - `cn(...)` — как в `src/ui/cn.ts`.

Значения цветов:

| Роль | Светлая | Тёмная |
| --- | --- | --- |
| canvas | `#f5f5f7` | `#000000` |
| surface | `#ffffff` | `#1c1c1e` |
| raised | `#ffffff` | `#2c2c2e` |
| ink | `#1d1d1f` | `#f5f5f7` |
| muted | `#6e6e73` | `#a1a1a6` |
| line | `#e5e5ea` | `#38383a` |
| action | `#1d1d1f` | `#f5f5f7` |
| on-action | `#ffffff` | `#1d1d1f` |
| accent | `#0a7d54` | `#30b07a` |
| accent-soft | `#e3f1ea` | `#12382a` |
| focus | `#0a7d54` | `#30b07a` |

`danger`, `danger-soft`, `warn`, `warn-soft` исполнитель подбирает в том же приглушённом тоне для обеих тем так, чтобы прошёл тест контраста; значения — в журнал строкой `Ruling`.

- [ ] **Step 1: тесты**

`theme.test.ts`:
```ts
expect(parseTheme("dark")).toBe("dark");
expect(parseTheme("light")).toBe("light");
expect(parseTheme(undefined)).toBe("system");
expect(parseTheme("")).toBe("system");
expect(parseTheme("<script>")).toBe("system");
```

`tokens.test.ts`: каждая роль из `TOKENS.light` и `TOKENS.dark` есть в `tokens.css` с тем же hex (светлые — в `:root`, тёмные — и в `[data-theme="dark"]`, и в `@media (prefers-color-scheme: dark)` под `:root:not([data-theme="light"])`); в `tokens.css` нет цветов вне `TOKENS`.

`contrast.test.ts` (для обеих тем, порог 4,5): `ink/canvas`, `ink/surface`, `ink/raised`, `muted/canvas`, `muted/surface`, `muted/raised`, `on-action/action`, `accent/surface`, `accent/canvas`, `accent/accent-soft`, `danger/surface`, `danger/danger-soft`, `warn/surface`, `warn/warn-soft`; порог 3,0: `focus/canvas`, `focus/surface`.

- [ ] **Step 2:** запустить `npx vitest run --project unit src/kit` — падает.
- [ ] **Step 3:** реализовать. `tokens.css`: `@theme` с обнулением стандартных шкал (`--color-*: initial` и т. д., как в `src/ui/tokens.css`) и ролями через CSS-переменные; размеры, радиусы и тени из Global Constraints. `app.css`: `@import "tailwindcss"`, токены, базовые стили `body` (фон `canvas`, текст `ink`, шрифт Inter, `text-body`), кольцо фокуса `focus`, глобальное правило `prefers-reduced-motion`. Ограничить источники классов Tailwind для `app.css` папками `src/kit` и `src/app/(app)` (директива `@source`), чтобы сборка v2 не тянула классы v1.
- [ ] **Step 4:** `(app)/layout.tsx`: `className={fontVariables}`, `data-theme` ставится только когда `getTheme()` вернул `light` или `dark`; `color-scheme` соответствует теме; `viewport.themeColor` — пара значений `canvas` для светлой и тёмной.
- [ ] **Step 5:** `npm run check` — зелёный. Коммит `feat(web): токены двух тем, Inter и выбор темы для v2`.

---

### Task 3: Определение устройства (Sonnet 5.5)

**Files:**
- Create: `src/platform/device.ts`, `src/platform/device.test.ts`

**Interfaces:**
- Produces: `type Device = "mobile" | "desktop"`; `deviceFromHeaders(get: (name: string) => string | null): Device`; `getDevice(): Promise<Device>` (обёртка над `headers()` из `next/headers`, с `cache` из React).

- [ ] **Step 1: тест** — таблица случаев:

| Заголовки | Ожидание |
| --- | --- |
| `sec-ch-ua-mobile: ?1` | mobile |
| `sec-ch-ua-mobile: ?0`, UA Windows Chrome | desktop |
| `sec-ch-ua-mobile: ?0`, UA `Android 14; SM-X710` без `Mobile` (планшет) | mobile |
| UA iPhone Safari, без client hints | mobile |
| UA Pixel 7 Chrome (`Android … Mobile`) | mobile |
| UA `iPad; CPU OS 17` | mobile |
| UA iPadOS Safari в режиме «как Mac» (`Macintosh; Intel Mac OS X`) | desktop (известное ограничение, комментарий в тесте) |
| UA macOS Safari | desktop |
| нет ни одного заголовка | desktop |
| UA `curl/8.5.0` | desktop |

- [ ] **Step 2:** запустить `npx vitest run --project unit src/platform/device.test.ts` — падает.
- [ ] **Step 3:** реализовать. Ширина окна и CSS-брейкпоинты в решении не участвуют.
- [ ] **Step 4:** тест зелёный, `npm run check`. Коммит `feat(web): версия интерфейса по типу устройства`.

---

### Task 4: Тесты-сторожа (Sonnet 5.5)

**Files:**
- Create: `src/kit/guards.test.ts`, `src/i18n/ru/app/kit.ts`
- Modify: `src/i18n/ru/app/index.ts`

**Interfaces:**
- Produces: тест, который обходит `src/kit/**/*.{ts,tsx}` и `src/app/(app)/**/*.{ts,tsx}` (кроме `*.test.*`, `tokens.ts`) и дерево `ru.app`.

- [ ] **Step 1:** написать `guards.test.ts`, по одному `it` на правило; сообщение об ошибке называет файл и строку:
  1. нет `font-bold`, `font-extrabold`, `font-black`;
  2. нет hex-цветов (`#rgb`, `#rrggbb`, `#rrggbbaa`) и функций `rgb(`/`hsl(` в `.tsx`;
  3. нет произвольных значений `text-[`, `rounded-[`, `bg-[#`, `border-[#`, `shadow-[`;
  4. нет импортов из `@/ui` и `@/app/(legacy)`;
  5. в `src/app/(app)/**` нет сырых `<button`, `<input`, `<select`, `<textarea` — только компоненты `@/kit`;
  6. в `src/app/(app)/**` строковые `href="/…"` не встречаются: адреса строятся через `to()` или `legacy()`;
  7. в `src/app/(app)/**/*.tsx` и `src/kit/**/*.tsx` нет кириллицы в строковых литералах и тексте JSX;
  8. в значениях `ru.app` нет подстроки «демо» (без учёта регистра).
- [ ] **Step 2:** к каждому правилу — самопроверка в том же файле: функция-детектор получает строку-нарушение и строку без нарушения (например, `"font-bold"` ловится, `"font-semibold"` нет; `href="/deals"` ловится, `href={to("/deals")}` нет).
- [ ] **Step 3:** `npx vitest run --project unit src/kit/guards.test.ts` — зелёный на текущем коде; если код задач 1–3 нарушает правило — исправить код, а не правило.
- [ ] **Step 4:** `npm run check`. Коммит `test(web): сторожа цельности нового интерфейса`.

---

### Task 5: Базовые элементы (Sonnet 5.5)

**Files:**
- Create: `src/kit/Button.tsx`, `src/kit/fields.tsx`, `src/kit/Card.tsx`, `src/kit/StatusChip.tsx`, `src/kit/List.tsx`, `src/kit/PageTitle.tsx`, `src/kit/Money.tsx`, `src/kit/PhotoSlot.tsx`, `src/kit/Skeleton.tsx`, `src/kit/Progress.tsx`, `src/kit/index.ts`, `src/kit/basics.test.tsx`

**Interfaces:**
- Consumes: токены и `cn` (задача 2), `ru.app.kit` (задача 4).
- Produces (все экспортируются из `@/kit`):
  - `Button({ variant?: "primary" | "secondary" | "quiet" | "danger"; size?: "md" | "sm"; pending?: boolean; full?: boolean } & ButtonHTMLAttributes)`; `ButtonLink({ href, variant?, size?, full? })`. `primary` ставит `data-primary-action`. Высота `md` 48 px, `sm` 36 px (только для второстепенных действий внутри карточек). `pending` блокирует повторное нажатие и показывает индикатор, не меняя ширины кнопки.
  - `TextField`, `TextArea`, `Select`, `Checkbox`, `RadioCard` — общие пропсы `{ label: string; error?: string; name: string }` + нативные; ошибка связана с полем через `aria-describedby`, поле получает `aria-invalid`.
  - `Card({ as?, padded?: boolean })`; `StatusChip({ tone: "accent" | "neutral" | "warn" | "danger"; children })`.
  - `List`, `ListRow({ label: ReactNode; value?: ReactNode; href?: string })` — строки с разделителем `line`, строка со ссылкой показывает шеврон и вся кликабельна.
  - `PageTitle({ title: string; back?: { href: string; label: string }; lead?: ReactNode })` — `<h1>`; `back` рендерит видимую ссылку «‹ {label}» над заголовком.
  - `Money({ tiyn: bigint })` — формат «1 224 000 ₸», неразрывные пробелы, `tabular-nums`; дробная часть показывается только когда тиыны не кратны 100 («1 224 000,50 ₸»).
  - `PhotoSlot({ src?: string; alt: string; ratio: "4/3" | "1/1" | "16/9" })` — без `src` ровная заглушка цвета `line`, без рисунка и иконки.
  - `Skeleton({ lines?: number })`; `Progress({ value: number; max: number; label: string })` — `role="progressbar"` с `aria-valuenow/max`.

- [ ] **Step 1: тест `basics.test.tsx`** (рендер через `renderToStaticMarkup`, как в `src/ui/components-a.test.tsx`):

```ts
// Button
expect(html(<Button>Ок</Button>)).toContain("data-primary-action");
expect(html(<Button variant="secondary">Ок</Button>)).not.toContain("data-primary-action");
expect(html(<Button pending>Ок</Button>)).toMatch(/disabled|aria-disabled="true"/);
// поле с ошибкой
const f = html(<TextField label="Почта" name="email" error="Проверьте адрес" />);
expect(f).toContain('aria-invalid="true"');
expect(f).toMatch(/aria-describedby="([^"]+)"[\s\S]*id="\1"|id="([^"]+)"[\s\S]*aria-describedby="\2"/);
// деньги
expect(text(<Money tiyn={122400000n} />)).toBe("1 224 000 ₸");
expect(text(<Money tiyn={122400050n} />)).toBe("1 224 000,50 ₸");
expect(text(<Money tiyn={0n} />)).toBe("0 ₸");
// заголовок
expect(html(<PageTitle title="Сделка" back={{ href: "/v2/deals", label: "Сделки" }} />)).toMatch(/<a[^>]+href="\/v2\/deals"/);
// прогресс
expect(html(<Progress value={2} max={3} label="Шаги" />)).toContain('aria-valuenow="2"');
// заглушка фото
expect(html(<PhotoSlot alt="Кухня" ratio="4/3" />)).not.toContain("<img");
```

- [ ] **Step 2:** запустить `npx vitest run --project unit src/kit/basics.test.tsx` — падает.
- [ ] **Step 3:** реализовать по Global Constraints и `docs/design/v3/rules.md`. Отклик на нажатие — `active:scale-[.97]` запрещён сторожем, поэтому масштаб задаётся токеном/утилитой в `tokens.css` (например, `--scale-press: 0.97`). Иконки `lucide-react` 20–24 px без подложек.
- [ ] **Step 4:** тесты и сторожа зелёные, `npm run check`. Коммит `feat(web): базовые элементы нового интерфейса`.

---

### Task 6: Шторка, поповер, диалог, пояснение, тост (Opus 5.5)

**Files:**
- Modify: `package.json`, `package-lock.json` (добавить `motion`, `radix-ui`, `vaul`, `sonner`)
- Create: `src/kit/Sheet.tsx`, `src/kit/Popover.tsx`, `src/kit/Dialog.tsx`, `src/kit/Explain.tsx`, `src/kit/Toaster.tsx`, `src/kit/motion.ts`, `src/kit/overlays.test.tsx`
- Modify: `src/kit/index.ts`, `src/i18n/ru/app/kit.ts`

**Interfaces:**
- Consumes: `Device` (задача 3), `Button` (задача 5).
- Produces:
  - `Sheet({ open, onOpenChange, title: string, children })` — шторка снизу (vaul): затемнение, ручка, тянется за пальцем, закрывается броском вниз, радиус `rounded-sheet`, фон `raised`.
  - `Popover({ trigger: ReactNode, title?: string, children })` — растёт из триггера (`transform-origin` от Radix), тень `shadow-float`.
  - `Dialog({ open, onOpenChange, title: string, description?: string, children })`; `ConfirmDialog({ title, description, confirmLabel, tone?: "primary" | "danger", onConfirm })` — на телефоне рендерится шторкой, на компьютере диалогом по центру.
  - `Explain({ label: string; title: string; children; device: Device })` — ссылка-кнопка цвета `accent`; `mobile` → `Sheet`, `desktop` → `Popover`.
  - `Toaster()` и `toast` (реэкспорт `sonner`) — позиция: телефон сверху по центру, компьютер снизу справа.
  - `SPRING = { default: { type: "spring", bounce: 0, duration: 0.35 }, flick: { type: "spring", bounce: 0.2, duration: 0.4 } }` из `@/kit/motion`.

- [ ] **Step 1:** установить зависимости, записать версии в журнал.
- [ ] **Step 2: тест `overlays.test.tsx`** (статический рендер закрытого состояния):

```ts
const m = html(<Explain label="Что это?" title="Защита сделки" device="mobile">Текст</Explain>);
expect(m).toMatch(/<button[^>]*>Что это\?<\/button>/);
expect(m).toContain('aria-haspopup="dialog"');
const d = html(<Explain label="Что это?" title="Защита сделки" device="desktop">Текст</Explain>);
expect(d).toContain('aria-haspopup="dialog"');
expect(SPRING.default.bounce).toBe(0);
```

- [ ] **Step 3:** запустить `npx vitest run --project unit src/kit/overlays.test.tsx` — падает.
- [ ] **Step 4:** реализовать. Требования поведения (проверяются e2e в задаче 10): фокус удерживается внутри и возвращается на триггер; Esc закрывает; при `prefers-reduced-motion` — проявление без сдвига; при `prefers-reduced-transparency` затемнение и фон сплошные; вход и выход по одному пути.
- [ ] **Step 5:** `npm run check`. Коммит `feat(web): шторка, поповер, диалог, пояснение и тосты`.

---

### Task 7: Блоки подсказок (Sonnet 5.5)

**Files:**
- Create: `src/kit/NowNext.tsx`, `src/kit/FirstSteps.tsx`, `src/kit/EmptyState.tsx`, `src/kit/HelpBlock.tsx`, `src/kit/WizardHeader.tsx`, `src/kit/guidance.test.tsx`
- Modify: `src/kit/index.ts`, `src/i18n/ru/app/kit.ts`, `src/config/brand.ts` (добавить `support.email`)

**Interfaces:**
- Produces:
  - `NowNext({ now: { title: string; body?: string }; next?: string })` — карточка «Сейчас» и строка «Дальше».
  - `FirstSteps({ steps: { label: string; done: boolean; href?: string }[] })` — заголовок из `ru.app.kit.firstSteps.left(n)` («Остался 1 шаг», «Осталось 2 шага», «Осталось 5 шагов»), `Progress`, список; возвращает `null`, когда все шаги выполнены или список пуст.
  - `EmptyState({ title: string; body: string; action?: { href: string; label: string } })`.
  - `HelpBlock({ items: { question: string; href: string }[]; supportEmail: string })` — заголовок «Помощь», вопросы строками `ListRow`, последняя строка — `mailto:`.
  - `WizardHeader({ step: number; total: number; title: string; back?: { href: string; label: string } })` — «Шаг N из M», `Progress`, заголовок `<h1>`.
  - `brand.support.email = "sunrisefeex@gmail.com"` (решение владельца; заменится адресом на домене продукта).

- [ ] **Step 1: тест `guidance.test.tsx`**

```ts
expect(html(<FirstSteps steps={[]} />)).toBe("");
expect(html(<FirstSteps steps={[{ label: "А", done: true }]} />)).toBe("");
expect(text(<FirstSteps steps={[{ label: "А", done: true }, { label: "Б", done: false }]} />)).toContain("Остался 1 шаг");
expect(text(<FirstSteps steps={[{ label: "А", done: false }, { label: "Б", done: false }]} />)).toContain("Осталось 2 шага");
expect(ru.app.kit.firstSteps.left(5)).toBe("Осталось 5 шагов");
expect(ru.app.kit.firstSteps.left(11)).toBe("Осталось 11 шагов");
expect(ru.app.kit.firstSteps.left(21)).toBe("Остался 21 шаг");
expect(html(<HelpBlock items={[]} supportEmail="a@b.kz" />)).toContain('href="mailto:a@b.kz"');
expect(text(<WizardHeader step={2} total={5} title="Почта" />)).toContain("Шаг 2 из 5");
expect(html(<EmptyState title="Пусто" body="Текст" />)).not.toContain("data-primary-action");
expect(html(<EmptyState title="Пусто" body="Текст" action={{ href: "/v2/requests/new", label: "Создать" }} />)).toContain("data-primary-action");
```

- [ ] **Step 2:** запустить — падает. **Step 3:** реализовать. **Step 4:** `npm run check`. Коммит `feat(web): блоки подсказок`.

---

### Task 8: Оболочки и навигация (Opus 5.5)

**Files:**
- Create: `src/app/(app)/_shell/nav.ts`, `nav.test.ts`, `MobileShell.tsx`, `DesktopShell.tsx`, `TabBar.tsx`, `TopNav.tsx`, `theme-actions.ts`, `ThemeSwitch.tsx`, `shell.test.tsx`
- Modify: `src/app/(app)/layout.tsx`, `src/i18n/ru/app/shell.ts`

**Interfaces:**
- Consumes: `getDevice` (задача 3), `getTheme`, `THEME_COOKIE` (задача 2), `to` (задача 1), `getShellUser` из `@/modules/identity`, `features` из `@/platform/features`.
- Produces:
  - `type NavItem = { href: string; label: string; icon: NavIcon }`; `type AppNav = { tabs: NavItem[]; primary?: { href: string; label: string }; guest: boolean }`; `navFor(user: NavUser | null, f: NavFeatures): AppNav` (типы `NavUser`, `NavFeatures` — того же вида, что в `src/app/(legacy)/_shell/nav.ts`, но объявлены заново).
  - `MobileShell({ nav, children })`, `DesktopShell({ nav, user, children })`.
  - `setTheme(theme: Theme): Promise<void>` — server action: валидирует zod-схемой, пишет куку `theme` (год, `SameSite=Lax`, `httpOnly: false` не нужен — читает сервер; `secure` вне dev).
  - `ThemeSwitch({ current: Theme })` — три варианта: «Как в системе», «Светлая», «Тёмная».

Состав вкладок (адреса через `to()`):

| Кто | Вкладки | Главное действие в шапке компьютера |
| --- | --- | --- |
| гость | Мастера `/catalog` · Как это работает `/about` · Войти `/login` | — |
| покупатель | Главная `/` · Заявки `/requests` · Сделки `/deals` · Чат `/chats` · Профиль `/profile` | «Новая заявка» `/requests/new` |
| мастер (одобрен) | Заявки `/executor/requests` · Заказы `/deals` · Чат `/chats` · Финансы `/executor/finance` · Профиль `/profile` | — |
| мастер (на проверке или отклонён) | Компания `/executor/profile` · Портфолио `/executor/portfolio` · Профиль `/profile` | — |
| оператор | пусто (оболочка оператора — этап 5; до неё оператор в v2 видит заглушку со ссылкой на v1) | — |

- [ ] **Step 1: тесты**

`nav.test.ts`: для каждой строки таблицы — точный список `label` и `href`; у покупателя `primary.href === "/v2/requests/new"`; ни в одной роли не больше 5 вкладок; у гостя `guest === true`.

`shell.test.tsx` (статический рендер):
```ts
const m = html(<MobileShell nav={clientNav}>x</MobileShell>);
expect(m).toMatch(/<nav[^>]+aria-label="Основное меню"/);
expect(count(m, "<a ")).toBeGreaterThanOrEqual(5);
const d = html(<DesktopShell nav={clientNav} user={client}>x</DesktopShell>);
expect(d).toContain('href="/v2/requests/new"');
expect(d).not.toContain("data-primary-action"); // кнопка шапки — secondary: главное действие принадлежит экрану
```

- [ ] **Step 2:** запустить `npx vitest run --project unit "src/app/(app)/_shell"` — падает.
- [ ] **Step 3:** реализовать.
  - Телефон: панель вкладок плавающая, отступ 10 px от краёв и снизу плюс `env(safe-area-inset-bottom)`, `rounded-bar`, полупрозрачная с `backdrop-filter`, `shadow-float`; активная вкладка — цвет `ink` и `aria-current="page"`; содержимое получает нижний отступ на высоту панели; колонка содержимого не шире 560 px по центру (планшеты).
  - Компьютер: шапка 52 px, прилипает, полупрозрачная; слева название из `brand`, разделы в строку, справа главное действие роли, колокольчик (ссылка на `/notifications`), аватар с меню (Radix: «Профиль», «Выйти»); содержимое по центру, `max-width` 1100 px; при окне уже 1024 px оболочка не перестраивается в мобильную.
  - Обе: ссылка «Перейти к содержимому» первой в порядке фокуса; `<main id>` с `tabIndex={-1}`; при недоступности `identity` — предупреждение `ru.common.errors.unavailable`, как в v1.
- [ ] **Step 4:** `(app)/layout.tsx` выбирает оболочку по `getDevice()`, ставит `data-device` на `<html>`, подключает `Toaster`.
- [ ] **Step 5:** `npm run check`. Коммит `feat(web): оболочки телефона и компьютера для v2`.

---

### Task 9: Витрина компонентов и скрипт скриншотов (Sonnet 5.5)

**Files:**
- Create: `src/app/(app)/v2/ui-kit/page.tsx`, `src/app/(app)/v2/ui-kit/Demo.tsx` (клиентские примеры шторки, диалога, тоста), `scripts/shots.ts`
- Modify: `src/app/(app)/v2/page.tsx`

**Interfaces:**
- Consumes: всё из `@/kit`, оболочки.
- Produces: `npx tsx scripts/shots.ts <путь> [<путь>…] [--out <папка>]` — для каждого пути четыре файла `<имя>-{mobile,desktop}-{light,dark}.png` в `test-results/shots/` (по умолчанию); мобильный контекст — `devices["Pixel 7"]`, компьютерный — 1440×900 с `Desktop Chrome`; тема задаётся кукой `theme`; база — `http://localhost:3110`. Скрипт сам сервер не поднимает. Для каждой страницы считает `[data-primary-action]` и завершается с кодом 1, если их больше одного (кроме пути `/v2/ui-kit`), печатая путь и число.

- [ ] **Step 1:** `ui-kit/page.tsx`: при `env().APP_ENV !== "dev"` — `notFound()`. Разделы: цвета (роли обеих тем), типографика, кнопки (все варианты и состояния), поля (обычное, с ошибкой, отключённое), карточки и списки, чипы, прогресс, деньги, заглушки фото, блоки подсказок, пояснение, шторка, диалог подтверждения, тост, переключатель темы. Тексты витрины — в `ru.app.kit.showcase`.
- [ ] **Step 2:** `v2/page.tsx` — временная главная на компонентах: `PageTitle`, `FirstSteps` с двумя шагами, `NowNext`, `EmptyState`, `HelpBlock` (данные-заглушки из `ru.app.shell.preview`; заменится на этапе 3).
- [ ] **Step 3:** написать `scripts/shots.ts`.
- [ ] **Step 4:** поднять стенд и сервер; `npx tsx scripts/shots.ts /v2 /v2/ui-kit`; убедиться, что создано 8 файлов и код возврата 0; закрыть сервер и стенд.
- [ ] **Step 5:** `npm run check`. Коммит `feat(web): витрина компонентов v2 и скрипт скриншотов`.

После этой задачи автор запускает первое ревью вида по скриншотам (шаг 5 harness) и исправления по нему — до задачи 10.

---

### Task 10: e2e каркаса v2 (Sonnet 5.5)

**Files:**
- Create: `e2e-v2/foundation.spec.ts`, `playwright.v2.config.ts`
- Modify: `package.json` (скрипт `test:e2e:v2`: `playwright test -c playwright.v2.config.ts`)

**Interfaces:**
- Consumes: `/v2`, `/v2/ui-kit`.
- Produces: конфигурация Playwright для v2 — тот же сервер и порт `3110`, проекты `mobile` (Pixel 7) и `desktop` (Desktop Chrome), `testDir: "./e2e-v2"`, без `globalSetup` пересева (каркас не меняет данных); подписи берутся из `ru` импортом, а не строками.

- [ ] **Step 1:** написать сценарии:
  1. `mobile`: на `/v2` видна навигация «Основное меню» внизу экрана (нижняя граница панели в пределах 40 px от низа окна), верхней шапки нет; `html[data-device="mobile"]`.
  2. `desktop`: на `/v2` шапка сверху, нижней панели нет; `html[data-device="desktop"]`.
  3. `desktop` с окном 480×800: по-прежнему `data-device="desktop"` и шапка сверху (узкое окно не даёт мобильную версию).
  4. Тема: с кукой `theme=dark` у `html` атрибут `data-theme="dark"` и вычисленный фон `body` — `rgb(0, 0, 0)`; с кукой `theme=<script>` атрибута `data-theme` нет и страница отвечает 200; с `colorScheme: "dark"` без куки фон тоже `rgb(0, 0, 0)`.
  5. `mobile`, `/v2/ui-kit`: открыть шторку кнопкой — фокус внутри шторки; `Tab` десять раз — фокус остаётся внутри; `Escape` — шторка закрыта, фокус на открывшей кнопке.
  6. `desktop`, `/v2/ui-kit`: то же для диалога подтверждения.
  7. `mobile` с `reducedMotion: "reduce"`: шторка открывается, у неё нет `transform`-сдвига в конечном состоянии и она видима.
  8. `mobile`, окно 360×740, размер шрифта 200% (`page.addStyleTag` с `html{font-size:200%}`): `document.documentElement.scrollWidth <= clientWidth` на `/v2`; подпись каждой вкладки не обрезана (`scrollWidth <= clientWidth` у элемента подписи).
  9. `/v2/deals/1` показывает заглушку со ссылкой на `/deals/1`.
  10. На `/v2` ровно один или ни одного `[data-primary-action]`.
- [ ] **Step 2:** поднять стенд и сервер; `npm run test:e2e:v2` — зелёный; затем `npx playwright test e2e/smoke.spec.ts e2e/30-shell.spec.ts` — зелёный (v1 цел); закрыть сервер и стенд.
- [ ] **Step 3:** `npm run check`. Коммит `test(web): e2e каркаса нового интерфейса`.

---

### Task 11: Завершение этапа (автор + ревьюер вида на Opus 5.5)

- [ ] **Step 1:** снять скриншоты `/v2`, `/v2/ui-kit`, `/v2/deals/1` в обеих версиях и темах; сквозное ревью вида по `checklist.md` и эталонам; замечания — задачами исполнителям по циклу harness.
- [ ] **Step 2:** `docs/design/v3/components.md` — справочник `@/kit`: компонент, пропсы, когда применять, пример (пишет исполнитель Sonnet по коду, автор вычитывает).
- [ ] **Step 3:** полный прогон: `npm run check`; e2e v1 целиком (`npm run test:e2e`) и `npm run test:e2e:v2` на стенде; закрыть порты.
- [ ] **Step 4:** записать итоги этапа в журнал и `docs/PROGRESS.md` (раздел «Новый интерфейс, этап 1»): что сделано, решения с ценой, что узнали для плана этапа 2.
- [ ] **Step 5:** влить `frontend-v2` в `main` (`git merge --no-ff`), без пуша; показать владельцу `/v2/ui-kit` и `/v2`.
