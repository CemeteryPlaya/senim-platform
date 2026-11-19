-- Свой дизайн-проект покупателя в заявке (спека 2026-11-19-request-design-project-design.md).
-- Новое значение ENUM в этой миграции не используется (нельзя в той же транзакции, где оно добавлено).
ALTER TYPE "FilePurpose" ADD VALUE 'REQUEST_DESIGN';

-- Скрытие файла оператором: без удаления, без внешнего ключа на оператора.
ALTER TABLE "StoredFile" ADD COLUMN "hiddenAt" TIMESTAMP(3), ADD COLUMN "hiddenById" TEXT;

-- Отметка «убрал из файлов контакты» при сохранении шага «Помещение» с файлами проекта.
ALTER TABLE "Request" ADD COLUMN "designConfirmedAt" TIMESTAMP(3);
