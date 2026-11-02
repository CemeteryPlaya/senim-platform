# Компоненты интерфейса (`import { … } from "@/ui"`)

Стили — только классы токенов: `bg-canvas`, `bg-surface`, `bg-sunken`, `text-ink`, `text-ink-soft`, `text-muted`, `text-accent`, `border-line`, `border-line-strong`, `rounded-card`, `rounded-control`, `rounded-chip`, `rounded-badge`, `shadow-card`, `shadow-raised`, `min-h-control` (56 px), `min-h-control-sm` (48 px), `max-w-page`/`max-w-form`/`max-w-prose`. Стандартная палитра Tailwind отключена (`bg-blue-500` не соберётся).

**Корневой layout уже даёт `<main id="content">`.** Страницы не рендерят свой `<main>`; ширину задают через `<Container>`. Один `h1` на странице — через `PageHeader`.

| Компонент | Пропсы | Пример |
|---|---|---|
| `Button` | пропсы `<button>` + `variant` (`primary`, `secondary`, `soft`, `ghost`, `danger` — красная рамка, `dangerSolid` — красная заливка), `loading`, `fullWidth`, `shape` (`pill`), `icon`, `iconEnd`; по умолчанию `type="button"` | `<Button type="submit" loading={pending}>Далее</Button>` |
| `ButtonLink` | пропсы `next/link` + стили кнопки | `<ButtonLink href="/requests/new">Оставить заявку</ButtonLink>` |
| `buttonClasses(opts)` | классы кнопки для своего элемента | `<label className={buttonClasses({ variant: "soft" })}>` |
| `Input`, `Textarea` | пропсы элемента + `label` (обязателен), `hint`, `error`, `optional`; `aria-invalid`/`aria-describedby` ставятся сами | `<Input label="Телефон" name="phone" type="tel" inputMode="tel" error={err} />` |
| `Select` | `options: {value,label}[]`, `placeholder` + пропсы поля | `<Select label="Срок" name="due" options={opts} />` |
| `Checkbox` | пропсы `input` + `label`, `hint`, `error` | `<Checkbox label="Подсветка" name="light" />` |
| `RadioCards` | `name`, `options: {value,label,description?,icon?,image?:{src,alt}}[]`, `value`+`onChange` или `defaultValue`, `columns` 1–3, `label`, `hint`, `error` | `<RadioCards label="Стиль" name="style" options={styles} />` |
| `Card` | `as`, `title`, `titleAs`, `description`, `footer`, `children`; карточку в карточку не вкладывать | `<Card title="Кухня">…</Card>` |
| `Container` | `size` (`page`, `form`, `prose`) | `<Container size="form">…</Container>` |
| `PageHeader` | `title`, `description`, `back={{href,label?}}`, `actions` | `<PageHeader title="Мои заявки" back={{ href: "/" }} />` |
| `Stepper` | `steps: string[]`, `current` (с нуля), `back: {href}` или `{onClick}` | `<Stepper steps={STEPS} current={1} back={{ href: "…" }} />` |
| `StatusBadge` | `tone` (`neutral`, `accent`, `info`, `success`, `warning`, `danger`), `icon`, текст обязателен | `<StatusBadge tone="warning">Ждёт оплаты</StatusBadge>` |
| `Alert` | `tone`, `title`, `action`, `live` (`polite`, `assertive`) | `<Alert tone="danger" live="assertive">{msg}</Alert>` |
| `Banner`, `DemoBanner`, `SimulatorBadge` | полоса во всю ширину; демо-полоса; метка «Симулятор банка» | `{rail === "escrow-simulator" && <SimulatorBadge />}` |
| `EmptyState` | `title`, `description`, `icon`, `action`, `titleAs` | `<EmptyState title="Заявок пока нет" />` |
| `Money` | `amount` (целые ₸) | `<Money amount={deal.totalAmount} />` |
| `DateText` | `value`, `format` (`date`, `dateTime`, `time`, `relative`) | `<DateText value={m.createdAt} format="relative" />` |
| `Skeleton` | `lines`; рядом нужен `aria-busy` или «Загрузка…» | `<Skeleton lines={3} />` |
| `Modal` (клиентский) | `open`, `onClose`, `title`, `description`, `footer`, `children`; нативный `<dialog>` | `<Modal open={o} onClose={close} title="Отменить заявку?" />` |
| `PhotoUpload` (клиентский) | `label`, `hint`, `error`, `photos: {id,src,status,progress?,error?}[]`, `onAdd(files)`, `onRemove(id)`, `onRetry?(id)`, `max`, `accept`; только интерфейс | `<PhotoUpload label="Фото помещения" photos={p} onAdd={upload} onRemove={del} />` |
| `Chat` (клиентский) | `messages: {id,kind:"own"\|"other"\|"system",author?,text,sentAt,masked?}[]`, `onSend(text)` (промис), `disabledReason`, `title`, `emptyText`, `maxLength` | `<Chat messages={msgs} onSend={send} />` |
| `ConfirmDialog` (клиентский) | `open`, `onCancel`, `onConfirm`, `title`, `description` (последствия простыми словами — связан через `aria-describedby`), `confirmLabel`, `cancelLabel` (не «Отмена», а «Не отменять»/«Не сейчас»), `tone` (`primary`, `danger`), `loading`; для кнопок-действий — `ConfirmSpec` `{title,text,yes,no,tone}` | `<ConfirmDialog open={o} title="Принять этап?" description="…" confirmLabel="Принять" cancelLabel="Не сейчас" tone="primary" … />` |
| `PhotoCard` | `image?: {src,alt?} \| null` (нет фото — заглушка), `title`, `titleAs`, `href` (вся карточка — ссылка), `linkLabel`, `badge`, `meta: {icon?,text}[]`, `aside` (цена), `footer` (кнопки вне ссылки), `layout` (`stacked` — фото сверху, `row` — слева), `as` | `<PhotoCard as="li" layout="row" href={`/requests/${id}`} image={{ src }} title="Кухня угловая" meta={[{ icon: <MapPin />, text: "Астана" }]} aside={<Money amount={1650000} />} />` |
| `FilterChips` | `label` (для диктора), `chips: {key,label,count?,href?}[]`, `current`, `onSelect?` (для чипов без `href`); ссылки — `aria-current`, кнопки — `aria-pressed`; переносятся, а не прокручиваются | `<FilterChips label="Показать заявки" current={mode} chips={[{ key: "all", label: "Все", count: 12, href: "/executor/requests" }]} />` |
| `LinkList` | `items: {href,label,icon?,description?,meta?,highlight?}[]`, `label`; `highlight` — один зелёный главный пункт | `<LinkList items={[{ href: "/executor/requests", label: "Новые заявки", icon: <Inbox />, meta: 3, highlight: true }]} />` |
| `Stat` | `value`, `label`, `icon`, `href?`; только настоящие числа | `<Stat icon={<Package />} value={2} label="Заказы в работе" />` |
| `Timeline` | `label`, `items: {title,description?,meta?,state:"done"\|"current"\|"todo"}[]` — ход дела сверху вниз | `<Timeline label="Ход заказа" items={steps} />` |
| `SectionTitle` | `title`, `id`, `as`, `action?: {href,label,ariaLabel?}` («Смотреть все») | `<SectionTitle id="deals" title="Мои заказы" action={{ href: "/deals", label: "Все заказы" }} />` |
| `focusFirstInvalid(root)` | после неудачной проверки формы — фокус на первое поле с `aria-invalid`; `false`, если такого нет | `if (!focusFirstInvalid(form)) summary.focus()` |
| `Button` `loading` | при загрузке `aria-disabled` + `aria-busy`, нажатие игнорируется; `disabled` не ставится, чтобы не терять фокус | `<Button loading={pending}>Отправить</Button>` |
| Форматтеры | `formatMoney`, `formatDate`, `formatDateTime`, `formatTime`, `formatRelative(value, now?)`, `formatDays`, `formatMonths`, `formatYears` (полные слова со склонением), `TIME_ZONE` (Asia/Almaty) | `formatMoney(10000)` → «10 000 ₸»; `formatDays(35)` → «35 дней» |

Необратимые действия (приёмка, оплата, выбор исполнителя, отмена) — только через подтверждение. Нижняя панель на телефоне задаёт `--tabbar-h`: закреплённые снизу блоки поднимаются на неё (`bottom-[calc(var(--tabbar-h)+1rem)] lg:bottom-4`).

Навигация по ролям — `src/app/_shell/nav.ts` (`navFor` → `{ tabs, more }`), её меняет только интегратор. Токены, правила и отступления от макетов — `docs/design/README.md`.
