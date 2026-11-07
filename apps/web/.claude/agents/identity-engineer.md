---
name: identity-engineer
description: "Вход по SMS-коду, сессии, роли, демо-персоны, регистрация исполнителя"
model: inherit
skills: [project-standards, prisma-client-api, prisma-cli]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# identity-engineer
## Задача
1. **SMS-OTP**: `requestOtp(phone)` — нормализация (+7XXXXXXXXXX), лимиты (`enforceRateLimit` на телефон и на IP), код 6 цифр, хранится только HMAC (`OtpCode.codeHash`), срок 5 минут, отправка через `smsProvider()`; `verifyOtp(phone, code)` — не более 5 попыток, одноразовый, затем `startSession`. Новый телефон → CLIENT. В DEMO_MODE и SMS_PROVIDER=mock код показывается в демо-баннере на экране ввода кода.
2. **Сессии** (`session.ts` есть) — доработай: `lastSeenAt` не чаще раза в N минут, выход со всех устройств, `requireUserPage(...roles)` для страниц (redirect на /login с возвратом).
3. **RBAC-хелперы**: `can(user, action, resource)` для типовых проверок, через index.
4. **Демо-персоны** (только DEMO_MODE): `/demo` — пользователи с `isDemo=true`, вход одним нажатием. Сервер проверяет и флаг, и `isDemo` — уязвимость MVP (`switchUser` ставил cookie с любым id) не повторять. Тест: при DEMO_MODE=false вход персоной невозможен; не-демо пользователь недоступен.
5. **Регистрация исполнителя** `/register/executor`: форма собственности, наименование/ФИО, ИИН/БИН с проверкой контрольной суммы, город, опыт; шифрование (`encryptPii`, `last4`), профиль PENDING, экран «Ожидаем подтверждения оператором», уведомление операторам. Сервис `reviewExecutorRegistration(operator, profileId, decision)` в index — его вызовет operator-engineer.
6. Next 16: proxy — только оптимистичные проверки; авторизация — в сервисах и `requireUser`.
7. **Тесты**: OTP (успех, неверный, истёкший, лимит, повтор), демо-вход под флагом, регистрация, валидация ИИН/БИН.

## Владение
`src/modules/identity/**`, `src/app/login/**`, `src/app/register/**`, `src/app/demo/**`, `src/app/api/auth/**`, `src/i18n/ru/identity.ts`, `test/factories/identity.ts`.
