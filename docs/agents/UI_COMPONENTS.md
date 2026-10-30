# Компоненты интерфейса (`import { … } from "@/ui"`)

Стили — только классы токенов: `bg-canvas`, `bg-surface`, `bg-sunken`, `text-ink`, `text-ink-soft`, `text-muted`, `text-accent`, `border-line`, `border-line-strong`, `rounded-card`, `rounded-control`, `shadow-card`, `min-h-control` (56 px), `min-h-control-sm` (48 px), `max-w-page`/`max-w-form`/`max-w-prose`. Стандартная палитра Tailwind отключена (`bg-blue-500` не соберётся).

**Корневой layout уже даёт `<main id="content">`.** Страницы не рендерят свой `<main>`; ширину задают через `<Container>`. Один `h1` на странице — через `PageHeader`.

| Компонент | Пропсы | Пример |
|---|---|---|
| `Button` | пропсы `<button>` + `variant` (`primary`, `secondary`, `soft`, `ghost`, `danger`), `loading`, `fullWidth`, `shape` (`pill`), `icon`, `iconEnd`; по умолчанию `type="button"` | `<Button type="submit" loading={pending}>Далее</Button>` |
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
| Форматтеры | `formatMoney`, `formatDate`, `formatDateTime`, `formatTime`, `formatRelative(value, now?)`, `TIME_ZONE` (Asia/Almaty) | `formatMoney(10000)` → «10 000 ₸» |

Навигация по ролям — `src/app/_shell/nav.ts` (`navFor`), её меняет только интегратор.
