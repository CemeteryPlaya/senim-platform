-- E-mail пользователя для копии подписанного акта (ТЗ п. 7): необязательный, без уникальности.
ALTER TABLE "User" ADD COLUMN "email" TEXT;
