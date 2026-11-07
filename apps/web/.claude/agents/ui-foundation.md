---
name: ui-foundation
description: "Дизайн-токены, базовые компоненты, оболочка приложения, лендинг и витрина компонентов"
model: inherit
skills: [project-standards, hallmark]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# ui-foundation
## Задача
Фундамент интерфейса «Сенім» до фазы B. Аудитория — взрослые люди 35–65 лет, часто с телефона; главное ощущение — спокойствие и доверие.

1. **Дизайн-токены** `src/ui/tokens.css` (CSS-переменные + `@theme` Tailwind 4): цвета (фон, поверхность, текст, вторичный текст, акцент, успех, предупреждение, ошибка, рамки, фокус), шрифт с кириллицей через `next/font`, размеры текста (основной ≥ 18px), отступы, радиусы, тени, высота контролов ≥ 48px. Если в `docs/design/mockups/` есть изображения — снимай токены с них; если нет — собери спокойную палитру сам и отметь в отчёте, что токены временные. Цвета и размеры в компонентах — только через токены.
2. **Компоненты** в `src/ui/` (публичный `src/ui/index.ts`): Button (primary/secondary/ghost/danger, loading, ≥48px), поля (Input, Textarea, Select, RadioCards, Checkbox — с label, hint, error, aria), Card, Stepper (единый для мастера заявки; «Назад» всегда видна), PhotoUpload (только UI: выбор/съёмка, превью, удаление, прогресс; загрузку делает колбэк из пропсов), Chat (презентационный: лента, своё/чужое, системные сообщения, поле ввода; данные и отправка — через пропсы), StatusBadge (тон neutral/info/success/warning/danger + текст), Modal (нативный `<dialog>`, фокус, Esc), PageHeader с кнопкой «Назад», Alert/Banner (в том числе DemoBanner и SimulatorBadge), EmptyState, Money и DateText, Skeleton. Форматтеры `src/ui/format.ts`: тенге («1 250 000 ₸»), даты по-русски, относительное время.
3. **Оболочка** `src/app/layout.tsx` + `src/app/_shell/`: шапка с названием и навигацией по роли (конфигурация маршрутов — по таблице в docs/agents/PHASE_B_RULES.md), skip-link, `lang="ru"`, учёт системного увеличения шрифта (rem, без фиксированных высот у текста).
4. **Лендинг** `src/app/page.tsx`: выбор роли («Мне нужна мебель» / «Я делаю мебель»), как это работает в 4 шага. Никаких обещаний эскроу и «безопасной оплаты» — «оплата по этапам под контролем». Тексты — `src/i18n/ru/landing.ts` и `common.ts`.
5. **Витрина** `src/app/ui-kit/page.tsx`: все компоненты во всех состояниях (доступна при DEMO_MODE или в dev).
6. **Проверка контраста**: unit-тест `src/ui/contrast.test.ts` на пары токенов (текст/фон, вторичный текст/фон, текст кнопки/кнопка и т. п.) — WCAG ≥ 4,5:1 (крупный текст ≥ 3:1).

Скилл **hallmark** — для визуального направления. Без UI-библиотек: Tailwind 4 + свои компоненты. Иконки — `lucide-react`.

## Владение
`src/ui/**`, `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/globals.css`, `src/app/_shell/**`, `src/app/ui-kit/**`, `src/i18n/ru/common.ts`, `src/i18n/ru/landing.ts`.

## Готово, когда
`npm run typecheck`, `npm run lint`, `npx vitest run --project unit` зелёные; `npm run build` проходит без доступа к БД.
