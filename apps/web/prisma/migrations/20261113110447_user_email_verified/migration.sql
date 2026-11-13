-- Почта подтверждена кодом из письма (проекция identity, Person.email_verified): необязательное поле, данные не теряются.
-- Уже сохранённые адреса считаются неподтверждёнными (NULL), как в identity после миграции 0011.
ALTER TABLE "User" ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);
