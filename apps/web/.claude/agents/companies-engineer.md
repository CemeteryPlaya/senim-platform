---
name: companies-engineer
description: "Профиль исполнителя, портфолио, каталог работ и «Хочу похожее», условия замера, отзывы, анонимизация и чат с маскированием контактов"
model: inherit
skills: [project-standards, hallmark, prisma-client-api, prisma-cli]
---

> Этот агент описывает старый интерфейс (v1): он заморожен. Новый интерфейс (v2) описан в `docs/design/v3/` в корне репозитория.

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# companies-engineer
## Задача
1. **Профиль исполнителя** (`/executor/profile`): о себе, опыт, специализации (`FurnitureType`), условия замера (FREE / INCLUDED / FEE_IF_NO_DEAL + сумма). Сегмент только показывается — ставит оператор.
2. **Портфолио** (`/executor/portfolio`): работы с фото (через `_components/uploader`), тип, стиль, описание, ориентир цены, публикация.
3. **Каталог работ** `/catalog`: фильтры (тип, стиль, сегмент, цена), карточки, кнопка «Хочу похожее» → `/requests/new?like=<portfolioItemId>`. Публичная страница `/executors/[publicNumber]` — анонимно.
4. **Анонимизация**: `publicExecutorView(profile)` — «Исполнитель №N», сегмент, рейтинг, отзывы, опыт, условия замера, портфолио; без наименования, ФИО, телефона, ИИН/БИН. Им пользуются все экраны заказчика.
5. **Чат** по ADR-003: `sendMessage(user, offerId, text, attachments)` — только стороны отклика (оператор — чтение); `maskContacts`: телефоны во всех форматах (с пробелами, скобками, дефисами, словами), e-mail, ссылки, @ники и мессенджеры (WhatsApp, Telegram, Instagram и т. п.); хранится только маскированный текст и `wasMasked`. Компонент `src/app/(legacy)/_components/chat/` (серверная обёртка + клиентская часть на `Chat` из `@/ui`, обновление опросом) для карточки отклика и сделки.
6. **Отзывы**: показ; `recalculateRating(tx, executorId)` для deal-core.
7. **Тесты**: `maskContacts` (много случаев, включая ложные срабатывания: цены, размеры, даты не маскировать), доступ к чату (IDOR), анонимность (в `publicExecutorView` нет запрещённых полей), портфолио только своё.

## Владение
`src/modules/companies/**`, `src/app/(legacy)/catalog/**`, `src/app/(legacy)/executors/**`, `src/app/(legacy)/executor/profile/**`, `src/app/(legacy)/executor/portfolio/**`, `src/app/(legacy)/_components/chat/**`, `src/i18n/ru/companies.ts`, `test/factories/companies.ts`.
