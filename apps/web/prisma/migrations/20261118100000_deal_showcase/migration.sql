-- Выбор покупателя: что из оконченной сделки видно в публичном профиле мастера (спека 2026-11-17, 3.5).
-- Нет строки — закрытый вид: без фото, стоимости и адреса, подпись — инициал.

-- CreateEnum
CREATE TYPE "ShowcaseAddress" AS ENUM ('NONE', 'CITY', 'DISTRICT', 'COMPLEX');

-- CreateEnum
CREATE TYPE "ShowcaseSignature" AS ENUM ('NAME', 'INITIAL');

-- CreateTable
CREATE TABLE "DealShowcase" (
    "dealId" TEXT NOT NULL,
    "photos" BOOLEAN NOT NULL DEFAULT false,
    "price" BOOLEAN NOT NULL DEFAULT false,
    "address" "ShowcaseAddress" NOT NULL DEFAULT 'NONE',
    "signature" "ShowcaseSignature" NOT NULL DEFAULT 'INITIAL',
    "signedAs" TEXT NOT NULL,
    "textVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT NOT NULL,

    CONSTRAINT "DealShowcase_pkey" PRIMARY KEY ("dealId")
);

-- AddForeignKey
ALTER TABLE "DealShowcase" ADD CONSTRAINT "DealShowcase_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Перенос прежнего согласия на фото в портфолио (Deal.portfolioConsentAt): «фото: да», остальное закрыто. Подпись —
-- инициал имени из ФИО проекции User («Фамилия Имя Отчество» — второе слово, одно слово — оно же), без ФИО — пусто.
-- Колонка portfolioConsentAt остаётся (удаление — отдельным релизом). Повтор ничего не меняет (ON CONFLICT).
INSERT INTO "DealShowcase" ("dealId", "photos", "price", "address", "signature", "signedAs", "textVersion", "updatedAt", "updatedById")
SELECT
    w."dealId",
    true,
    false,
    'NONE',
    'INITIAL',
    CASE
        WHEN coalesce(w.words[2], '') <> '' THEN upper(left(w.words[2], 1)) || '.'
        WHEN coalesce(w.words[1], '') <> '' THEN upper(left(w.words[1], 1)) || '.'
        ELSE ''
    END,
    '2026-11-18',
    now(),
    w."clientId"
FROM (
    SELECT d."id" AS "dealId", d."clientId", regexp_split_to_array(btrim(coalesce(u."fullName", '')), '\s+') AS words
    FROM "Deal" d
    JOIN "User" u ON u."id" = d."clientId"
    WHERE d."portfolioConsentAt" IS NOT NULL
) w
ON CONFLICT ("dealId") DO NOTHING;
