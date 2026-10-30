---
name: platform-engineer
description: "Модули files и notifications: StorageProvider (local, s3, vercel-blob), загрузка по подписанной ссылке, сжатие, EXIF, перцептивный хэш, in-app уведомления, SmsProvider"
model: inherit
skills: [project-standards, prisma-client-api, prisma-cli]
---

Прочитай ./SKILL.md и следуй ему. Затем прочитай docs/agents/PHASE_B_RULES.md и выполняй его правила.

# platform-engineer
## Задача
1. **StorageProvider**: `local` (есть; добавь подписанные HMAC ссылки на скачивание с `FILE_URL_SECRET` и маршрут `/api/files/[...key]`), `s3` (`@aws-sdk/client-s3` + `s3-request-presigner`, любое S3-совместимое, `forcePathStyle`), `vercel-blob` (`@vercel/blob`) и `static` — только чтение из `public/` для демо-данных сида (`StoredFile.provider = "static"`, ключ — путь внутри `public/`). Тесты local и static; s3 и blob — на моках клиента.
2. **Загрузка**: `createUpload(user, {purpose, contentType, size})` → подписанная цель (s3/blob — прямая загрузка из браузера; local — наш маршрут с HMAC); `finalizeUpload` → проверка типа по сигнатуре байтов (JPEG/PNG/WEBP/HEIC→JPEG; PDF только для документов), лимит размера, сжатие (`sharp`), удаление EXIF (геолокация) с сохранением ориентации, sha256, перцептивный хэш (dHash 64 бит), запись `StoredFile`. Лимит тела Vercel 4,5 МБ — поэтому прямая загрузка, а не через Server Action. `findSimilar(phash, maxDistance)` — поиск повторов (чужие фото в портфолио).
3. **Права на файл**: `canReadFile(user, file)` по владельцу-сущности (портфолио — публично; фото помещения — заказчик и исполнители, видящие заявку; этап — стороны сделки; документы — стороны и оператор).
4. **Компонент** `src/app/_components/uploader/` — связывает `PhotoUpload` из `@/ui` с `createUpload`/`finalizeUpload`, отдаёт id файлов через `onChange`. Пример использования — в отчёт.
5. **Уведомления**: шаблоны `templates.ts` (ключ → заголовок/текст/ссылка, тексты в `ru.notifications`), `notifyTemplate(tx, userId, key, params)`, страница `/notifications`, колокольчик `src/app/_components/notifications/`. SMS по важным событиям — задача `notifications.sendSms` (идемпотентная); `SmsProvider http` — скелет без выдуманного API: универсальный POST с токеном из env и TODO.
6. **Тесты**: подпись ссылок (истёкшая/подделанная отклонены), тип по байтам, удаление EXIF, dHash устойчив к пережатию и различает разные изображения, права на файл, шаблоны.

## Владение
`src/modules/files/**`, `src/modules/notifications/**`, `src/app/api/files/**`, `src/app/notifications/**`, `src/app/_components/uploader/**`, `src/app/_components/notifications/**`, `src/i18n/ru/files.ts`, `src/i18n/ru/notifications.ts`.
