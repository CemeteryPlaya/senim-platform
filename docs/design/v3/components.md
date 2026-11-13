# Справочник компонентов `@/kit`

Для авторов экранов нового интерфейса (v2). Всё ниже взято из кода `apps/web/src/kit/`; чего здесь нет, того в kit нет.
Правила вида и поведения — в `rules.md` и `checklist.md` рядом; эталоны — в `reference/`. Живые образцы всех компонентов — на `/v2/ui-kit` (`apps/web/src/app/(app)/v2/ui-kit/`).

## Как пользоваться

- **Импорт только из `@/kit`** (`import { Button, Card } from "@/kit"`). Внутренние модули (`button-styles`) снаружи не импортируются.
- **Тексты только из `ru`** (`ru.app.<экран>.*`, файлы в `apps/web/src/i18n/ru/app/`), в разметке и строках кириллицы нет. Ключи `ru.app.requests.*` в примерах ниже условные: свои добавляйте рядом с экраном.
- **Адреса только через `to()`** (`import { to } from "../_shell/paths"`: `to("/deals/42")` → `/v2/deals/42`) и `legacy()` для ссылки в v1.
- **Устройство** — телефон или компьютер — различают варианты `desktop:` и `mobile:` (атрибут `data-device` на `<html>`), а не ширина окна. Серверный экран получает устройство так: `const device = await getDevice()` (`@/platform/device`) и передаёт его в компоненты, которым оно нужно (`ConfirmDialog`, `Explain`, `Toaster`).
- **Одно главное действие на экран.** Главное — `Button`/`ButtonLink` без `variant` (или `variant="primary"`). Остальные — `secondary`, `quiet`, `danger`.
- Серверные компоненты: `Stack`, `Split`, `Narrow`, `Section`, `Card`, списки, `StatusChip`, `Money`, `Progress`, `PhotoSlot`, `PageTitle`, `BackLink`, `WizardHeader`, `NowNext`, `FirstSteps`, `EmptyState`, `HelpBlock`, `ButtonLink`, `Skeleton`. Клиентские (`"use client"`): `Button`, поля, `Sheet`, `Dialog`, `ConfirmDialog`, `Popover`, `Explain`, `Toaster`. Клиентский компонент можно ставить в серверный экран.

### Что запрещают сторожа

Сторожа (`src/kit/guards.test.ts`) читают исходники `src/kit/**` и `src/app/(app)/**`; нарушение — красный тест.

1. Вес шрифта не выше 600: нет `font-bold`, `font-extrabold`, `font-black`, `fontWeight` 700 и выше.
2. Нет сырых цветов: ни hex, ни `rgb()`, `hsl()`, `oklch()` — только токены `tokens.css` (`text-ink`, `bg-surface`…).
3. Нет произвольных значений Tailwind: `text-[15px]`, `rounded-[10px]`, `bg-[#fff]`, `max-w-(--x)` запрещены; разрешены токены и `data-[state=open]:` как вариант.
4. Нет импортов старого интерфейса: `@/ui`, `@/app/(legacy)`, относительные пути в них.
5. В экранах нет сырых `<button>`, `<input>`, `<select>`, `<textarea>` — только компоненты kit.
6. Адреса строятся через `to()`/`legacy()`: нет `href="/..."`, `redirect("/...")`, `router.push("/...")` с литералом.
7. Нет кириллицы в разметке и строках (комментарии по-русски можно).
8. В `ru.app` нет слов «демо», «комиссия», «эскроу».
9. Нет `sm:`, `md:`, `lg:`, `xl:`, контейнерных `@md:`, `@media (width…)`, `matchMedia`, `innerWidth` — версии различают `desktop:` и `mobile:`.
10. `button-styles` импортируют только файлы kit.

Отдельно: анимируются только `transform` и `opacity`; размеры текста, радиусы, тени, цвета — токены; контролы не ниже 48 px (на компьютере вторичные `sm` — 36 px).

---

## Раскладка

Серверные компоненты. Брейкпоинтов нет: узкое окно компьютера остаётся компьютерной раскладкой.

### `Stack`

Вертикальный поток с отступом по шкале.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `gap` | `"tight" \| "group" \| "section"` | `"group"` | 8 px · 12 px (карточки одной группы) · 24 px телефон / 32 px компьютер (между разделами) |
| `className` | `string` | — | Дополнение классов |
| `children` | `ReactNode` | — | Содержимое |

### `Split`

Две колонки на компьютере (1,5 : 1, выровнены по верху), на телефоне — одна: сначала `main`, затем `aside`.

| Проп | Тип | Смысл |
|---|---|---|
| `main` | `ReactNode` | Основная колонка (слева) |
| `aside` | `ReactNode` | Боковая колонка (справа); на телефоне уходит вниз |

### `Narrow`

Ограничивает ширину до 560 px на компьютере (по левому краю); на телефоне ничего не делает. Для форм и строк «подпись — значение». Проп один: `children`.

### `Section`

Раздел экрана: `<h2>` и содержимое через зазор группы. Заголовок стоит ровно по левому краю карточек.

| Проп | Тип | Смысл |
|---|---|---|
| `title` | `string` | Текст заголовка раздела |
| `children` | `ReactNode` | Содержимое |

```tsx
<Stack gap="section">
  <PageTitle title={t.title} />
  <Split
    main={<Section title={t.sectionRequests}>{/* карточки */}</Section>}
    aside={<HelpBlock items={helpItems} supportEmail={brand.support.email} />}
  />
</Stack>
```

---

## Кнопки

### `Button` (клиентский) и `ButtonLink` (серверный)

`Button` — действие на экране; `ButtonLink` выглядит так же, но это ссылка (переход на другой экран). Тип пропсов `Button` — обычный `<button>`; `ButtonLink` — пропсы `next/link` плюс вид.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `variant` | `"primary" \| "secondary" \| "quiet" \| "danger"` | `"primary"` | Вид. `primary` — единственное главное действие экрана |
| `size` | `"md" \| "sm"` | `"md"` | `md` — 48 px. `sm` — только у не-главных: 48 px на телефоне, 36 px на компьютере. `primary` с `sm` не собирается типом |
| `full` | `boolean` | `false` | На всю ширину контейнера |
| `pending` | `boolean` | `false` | Только у `Button`. Идёт действие: индикатор вместо подписи (ширина не меняется), `aria-busy`, нажатие и повторная отправка формы гасятся, фокус остаётся |
| `type` | `"button" \| "submit" \| "reset"` | `"button"` | Только у `Button`; для отправки формы указывайте `type="submit"` |

Заметки:

- Главная кнопка помечается `data-primary-action`; тесты считают «одна на экран». Не ставьте две.
- `danger` — необратимое действие; само необратимое действие подтверждайте через `ConfirmDialog`.
- Подпись — глагол, называющий результат («Создать заявку»), не «Ок».
- `buttonClasses(options)` отдаёт классы кнопки для случаев, когда элемент не `<button>` и не `<Link>`.

```tsx
<Stack>
  <ButtonLink href={to("/requests/new")}>{t.create}</ButtonLink>
  <Button variant="secondary" size="sm" onClick={save} pending={saving}>
    {t.saveDraft}
  </Button>
</Stack>
```

---

## Поля

Клиентские. У всех обязательны `label` (видимая подпись) и `name`; `error` показывается сразу под полем (`role="alert"`, связь через `aria-describedby`, рамка `danger`). Остальные пропсы — как у соответствующего нативного элемента (кроме `name`, который здесь обязателен и определён в `FieldProps`). Высота поля 48 px.

| Компонент | Нативная основа | Особенности |
|---|---|---|
| `TextField` | `<input>` | `type`, `inputMode`, `autoComplete` и прочее передаются как есть |
| `TextArea` | `<textarea>` | `rows` по умолчанию 4; высота растёт по содержимому от трёх строк; без уголка изменения размера |
| `Select` | `<select>` | Подсказка пустого выбора — `<option value="">`: пока выбран он, текст muted |
| `Checkbox` | `<input type="checkbox">` | `label` справа от квадрата; весь ряд — цель касания |
| `RadioCard` | `<input type="radio">` | Вариант выбора карточкой; выбранный выделен рамкой цвета действия. `label` и `name` обязательны; ошибки нет — она у группы |
| `RadioGroup` | `<fieldset>` | `legend: string`, `error?: string`, `children` (набор `RadioCard`) |

Общие пропсы `FieldProps`:

| Проп | Тип | Смысл |
|---|---|---|
| `label` | `string` | Подпись поля |
| `name` | `string` | Имя поля формы |
| `error` | `string?` | Текст ошибки (из `ru`, код ошибки сервиса → текст на стороне web) |

```tsx
<Narrow>
  <Stack>
    <TextField label={t.title} name="title" autoComplete="off" error={errors.title} />
    <RadioGroup legend={t.kind} error={errors.kind}>
      <RadioCard label={t.kindKitchen} name="kind" value="kitchen" />
      <RadioCard label={t.kindWardrobe} name="kind" value="wardrobe" />
    </RadioGroup>
    <Button type="submit" pending={pending}>{t.submit}</Button>
  </Stack>
</Narrow>
```

---

## Карточки и списки

### `Card`

Светлая карточка без рамки и тени, радиус 18 px.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `as` | `"div" \| "section" \| "article" \| "li"` | `"div"` | Тег |
| `padded` | `boolean` | `true` | Внутренний отступ 16 px; `false` — когда внутри списки или фото во всю ширину |
| `className` | `string` | — | Дополнение классов |

### `List`, `ListRow`, `ListItem`

`List` — `<ul>`; кладётся в `Card` (обычно `padded={false}`). Строки — только `ListRow` или `ListItem` (голый `<li>` нельзя: у него не будет разделителя).

`ListRow` — строка «подпись — значение»:

| Проп | Тип | Смысл |
|---|---|---|
| `label` | `ReactNode` | Подпись (ink) |
| `value` | `ReactNode?` | Значение справа (muted). Сумма — `<Money>`: цвет ink она задаёт сама |
| `href` | `string?` | Есть адрес — вся строка ссылка, справа шеврон (через `to()`) |

`ListItem` — обёртка для строки со своей разметкой (`children`), даёт разделитель с отступом 16 px; у последней строки разделителя нет.

```tsx
<Card padded={false}>
  <List>
    <ListRow label={t.price} value={<Money tiyn={deal.priceTiyn} />} />
    <ListRow label={t.master} value={master.name} href={to(`/masters/${master.id}`)} />
  </List>
</Card>
```

---

## Статусы, деньги, прогресс, фото, загрузка

### `StatusChip`

Плашка статуса сделки или заявки (13 px / 600).

| Проп | Тип | Смысл |
|---|---|---|
| `tone` | `"accent" \| "neutral" \| "warn" \| "danger"` | Окраска: `accent` — идёт нормально, `neutral` — фон, `warn` — нужно внимание, `danger` — проблема |
| `children` | `ReactNode` | Текст статуса из `ru` |

### `Money` и `formatMoney`

Сумма **в тиынах, `bigint`** (1 тенге = 100 тиын): `<Money tiyn={122400000n} />` → «1 224 000 ₸». Тиыны показываются, когда сумма не кратна 100. Никаких `number` и float.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `tiyn` | `bigint` | — | Сумма в тиынах |
| `tone` | `"ink" \| "inherit"` | `"ink"` | `inherit` — цвет окружения (сумма внутри вторичного текста) |

`formatMoney(tiyn: bigint): string` — та же строка без разметки (для `aria-label`, тостов). Суммы считает сервис `deal` (`ComputeDealMoney`), экран их только показывает.

### `Progress`

Полоса прогресса, 4 px, `role="progressbar"`.

| Проп | Тип | Смысл |
|---|---|---|
| `value` | `number` | Текущее значение (ограничивается 0…`max`) |
| `max` | `number` | Максимум; `max <= 0` или не число — ничего не рисуется |
| `label` | `string` | Подпись для диктора |

### `PhotoSlot`

Место под фото; без `src` — ровная заглушка цвета `line`.

| Проп | Тип | Смысл |
|---|---|---|
| `src` | `string?` | Адрес снимка из хранилища файлов |
| `alt` | `string` | Описание (обязательно) |
| `ratio` | `"4/3" \| "1/1" \| "16/9"` | Соотношение сторон |

### `Skeleton`

Заготовка строк, пока грузятся данные: статичная, диктор слышит «Загрузка». Проп `lines?: number` (по умолчанию 3).

```tsx
<Card>
  <ListRow label={t.paid} value={<Money tiyn={paidTiyn} />} />
  <StatusChip tone="warn">{t.statusWaiting}</StatusChip>
  <Progress value={stage} max={5} label={t.progress} />
</Card>
```

---

## Навигация внутри экрана

### `PageTitle`

Заголовок экрана — единственный `<h1>` (28 px на телефоне, 32 px на компьютере).

| Проп | Тип | Смысл |
|---|---|---|
| `title` | `string` | Текст заголовка |
| `back` | `{ href: string; label: string }?` | Вложенный экран: ссылка на родителя над заголовком |
| `lead` | `ReactNode?` | Пояснение под заголовком (muted) |

### `BackLink`

«‹ Название родителя» — один вид везде. Диктор слышит «Назад: …». Обычно отдельно не нужен: передавайте `back` в `PageTitle` или `WizardHeader`. Пропсы: `href: string` (через `to()`), `label: string` (название родителя, не слово «Назад»).

### `WizardHeader`

Шапка шага мастера: «Шаг N из M», полоса и заголовок.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `step` | `number` | — | Номер шага (округляется и ограничивается 1…`total`) |
| `total` | `number` | — | Всего шагов; не положительное — счётчик и полоса не рисуются |
| `title` | `string` | — | Заголовок шага |
| `back` | `{ href; label }?` | — | Ссылка «Назад» |
| `headingLevel` | `1 \| 2` | `1` | Уровень заголовка |

Заметки: `WizardHeader` **сам рисует `<h1>` экрана**, поэтому `PageTitle` рядом не ставят. `headingLevel={2}` нужен только когда `<h1>` на странице уже есть (как в образце витрины).

```tsx
<Stack gap="section">
  <WizardHeader step={2} total={4} title={t.stepTitle} back={{ href: to("/requests/new"), label: t.backLabel }} />
  <Narrow>{/* поля шага */}</Narrow>
  <Button type="submit">{t.next}</Button>
</Stack>
```

---

## Подсказки

Блоки, которые объясняют, что происходит и что делать дальше.

### `NowNext`

Первая карточка сделки или заявки: «Сейчас» и «Дальше».

| Проп | Тип | Смысл |
|---|---|---|
| `now` | `{ title: string; body?: string }` | Что происходит сейчас |
| `next` | `string?` | Что будет после: одна короткая строка |

### `FirstSteps`

Список первых шагов с полосой. Возвращает `null`, когда шагов нет или все пройдены. Проп `steps: FirstStep[]`, где `FirstStep = { label: string; done: boolean; href?: string }`. Ссылка работает только у невыполненного шага.

### `EmptyState`

Обучающий пустой экран: что здесь будет и что сделать первым.

| Проп | Тип | Смысл |
|---|---|---|
| `title` | `string` | Заголовок |
| `body` | `string` | Пояснение |
| `action` | `{ href: string; label: string }?` | **Единственное главное действие экрана** (кнопка-ссылка `primary`); без него кнопки нет |

Если `EmptyState` с `action` есть на экране, других `primary`-кнопок там быть не должно.

### `HelpBlock`

«Помощь» под содержимым главной и сделки: частые вопросы и письмо в поддержку.

| Проп | Тип | Смысл |
|---|---|---|
| `items` | `{ question: string; href: string }[]` | Вопросы-ссылки (адреса через `to()`) |
| `supportEmail` | `string` | Адрес поддержки (`brand.support.email` из `@/config/brand`) |

### `Explain`

Пояснение по нажатию — только для сложных мест (защита сделки, гарантия оплаты, где деньги, спор). Телефон — шторка с кнопкой «Понятно», компьютер — поповер. Клиентский.

| Проп | Тип | Смысл |
|---|---|---|
| `label` | `string` | Подпись ссылки («Что это?») |
| `title` | `string` | Заголовок пояснения |
| `device` | `"mobile" \| "desktop"` | Откуда брать вид |
| `children` | `ReactNode` | Текст пояснения |

Не злоупотребляйте: обычное пояснение пишется текстом рядом.

```tsx
const device = await getDevice();
// ...
<Stack>
  <NowNext now={{ title: t.nowTitle, body: t.nowBody }} next={t.next} />
  <Explain label={t.whatIsIt} title={t.protectionTitle} device={device}>
    <p>{t.protectionBody}</p>
  </Explain>
</Stack>
```

---

## Окна и уведомления

Клиентские. Все окна: Tab ходит по кругу внутри, Esc и затемнение закрывают, фокус возвращается на кнопку-открыватель, при `prefers-reduced-motion` вместо сдвигов — проявление.

### `Sheet` (телефон)

Шторка снизу: пояснения, подтверждения, выбор из списка. Жест (тянуть, бросить вниз) даёт vaul; схватить шторку в первые 500 мс открытия нельзя.

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `title` | `string` | — | Заголовок (обязателен: имя окна для диктора) |
| `description` | `string?` | — | Пояснение под заголовком |
| `trigger` | `ReactElement?` | — | Кнопка-открыватель (один элемент) |
| `open`, `onOpenChange` | `boolean`, `(open) => void` | — | Управляемый режим; без `open` шторка управляется сама |
| `dismissible` | `boolean` | `true` | `false` — нельзя закрыть жестом, затемнением и Esc (пока идёт действие) |
| `onOpenAutoFocus` | `(event: Event) => void` | — | Первый фокус; по умолчанию — сама шторка, чтобы клавиатура не выезжала вместе с ней |
| `children` | `ReactNode` | — | Содержимое |

### `Dialog` (компьютер)

Диалог по центру. Те же пропсы, что у `Sheet` (`title`, `description`, `trigger`, `open`, `onOpenChange`, `dismissible`, `onOpenAutoFocus`, `children`), `dismissible={false}` отключает также крестик. Для подтверждений используйте `ConfirmDialog`, а не `Dialog` с самодельными кнопками.

### `ConfirmDialog`

Подтверждение действия: на телефоне шторка, на компьютере диалог. Одна главная кнопка и отказ; первый фокус — на «Отмене».

| Проп | Тип | По умолчанию | Смысл |
|---|---|---|---|
| `device` | `"mobile" \| "desktop"` | — | Какое окно показать |
| `title` | `string` | — | Заголовок |
| `description` | `string` | — | Что произойдёт |
| `confirmLabel` | `string` | — | Глагол, называющий результат («Отменить сделку»), не «Ок» |
| `cancelLabel` | `string` | `ru.app.kit.cancel` | Подпись отказа |
| `tone` | `"primary" \| "danger"` | `"primary"` | `danger` — необратимое действие |
| `onConfirm` | `() => void \| boolean \| Promise<void \| boolean>` | — | Действие |
| `trigger`, `open`, `onOpenChange` | как у `Dialog` | — | Открытие |

Поведение `onConfirm`:

- Пока оно идёт, кнопка показывает ожидание; повторное нажатие и закрытие окна (Esc, затемнение, жест, «Отмена») не срабатывают. Двойной клик не даёт двойного эффекта.
- Вернуло ничего или `true` — окно закрывается.
- Вернуло `false` — окно **остаётся открытым**. Так отвечают, когда сервер отказал.
- Бросило исключение или промис отклонён — окно остаётся открытым, ошибка пишется в лог (`logger.warn`) и дальше не идёт.
- **Показать ошибку пользователю обязан сам `onConfirm`** — тостом `toast.error(t.text)`. Окно текста ошибки не знает.

```tsx
<ConfirmDialog
  device={device}
  tone="danger"
  trigger={<Button variant="danger">{t.cancelDeal}</Button>}
  title={t.cancelTitle}
  description={t.cancelBody}
  confirmLabel={t.cancelConfirm}
  onConfirm={async () => {
    const ok = await cancelDeal(deal.id, idempotencyKey);
    if (!ok) toast.error(t.cancelFailed);
    return ok;
  }}
/>
```

### `Popover` (компьютер)

Поповер у кнопки: пояснение, короткий выбор. Немодальный: страница за ним прокручивается, нажатие вне закрывает и сразу срабатывает там, куда нажали.

| Проп | Тип | Смысл |
|---|---|---|
| `trigger` | `ReactElement` | Кнопка-открыватель (обязательна) |
| `title` **или** `label` | `string` | Имя для диктора: видимый заголовок или, без заголовка, `aria-label`. Один из двух |
| `open`, `onOpenChange` | `boolean`, `(open) => void` | Управляемый режим |
| `children` | `ReactNode` | Содержимое (ширина 20 rem) |

### `Toaster` и `toast`

`toast("Сохранено")`, `toast.error(...)`, `toast.loading(...)` — тосты (sonner). `toast` вызывается из обработчиков клиентских компонентов. `Toaster` ставит **оболочка**, один на всё приложение (`device`: телефон — сверху по центру, компьютер — снизу справа); в экранах его не монтируют.

```tsx
<Button variant="secondary" onClick={() => toast(t.saved)}>
  {t.save}
</Button>
```

---

## Тема

### `Segmented`

Сегментированный переключатель: равные сегменты в одну строку, выбранный — `aria-pressed`. Сегменты — кнопки отправки одной формы, **форму даёт вызывающий**; у каждого своё действие сервера (`formAction`), поэтому работает и без JavaScript.

| Проп | Тип | Смысл |
|---|---|---|
| `legend` | `string` | Подпись группы |
| `options` | `{ value: string; label: string; formAction }[]` | Сегменты; подписи короткие |
| `value` | `string` | Выбранное значение |

### `ThemeSwitch`

Не часть kit: лежит в оболочке (`apps/web/src/app/(app)/_shell/ThemeSwitch.tsx`) и собран из `Segmented`: «Как в системе / Светлая / Тёмная», кука `theme`. Ставят в настройках и на витрине, свой не пишут. Для выбора темы в коде есть `getTheme()` и `parseTheme()` (`@/kit/theme`, тип `Theme = "system" | "light" | "dark"`).

---

## Вспомогательное

- `cn(...)` — склейка классов (для `className` у `Card`, `Stack`, `Button`).
- `SPRING` — параметры пружины без отскока для собственного движения (анимировать только `transform` и `opacity`).
- `formatMoney`, `buttonClasses` — см. выше.

## Чего в kit нет и как поступать

Нет, в частности: таблиц, вкладок внутри экрана, календаря и выбора даты, загрузки файлов, карусели и галереи, баннера-предупреждения, выпадающего меню действий, поля телефона и суммы с маской, пагинации и «ещё»-списков, аватара.

Если нужного нет:

1. Сначала проверьте, не решается ли это сочетанием имеющегося (`Card` + `List` + `StatusChip` закрывают большинство списков и сводок).
2. Если не решается, **попросите новый компонент kit** (владельцу дизайн-системы) — с описанием, где он нужен и по какому эталону из `reference/`. Не собирайте его вручную в экране: сторожа запретят сырые `<button>`/`<input>`, произвольные значения и цвета, а разные самодельные версии разойдутся по виду и доступности.
3. Новый компонент появляется в `src/kit/` с тестом, образцом на `/v2/ui-kit` и строкой в этом справочнике; до этого экран ждёт или показывает ближайшее готовое.
4. Тексты компонентов kit берутся из `ru.app.kit`, не из экрана; компонент не знает ни слов предметной области, ни адресов.
