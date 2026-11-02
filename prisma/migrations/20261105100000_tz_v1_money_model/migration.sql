-- ТЗ MVP v1.0 (ADR-009): модель денег, статусы ТЗ п. 9, журнал денег, торг, грейд, KYC, IBAN, GPS,
-- собственноручные подписи, push-подписки, публичный идентификатор сделки, IP и устройство в аудите.
-- Данные переносятся: статусы сделок по таблице ADR-009, суммы ×100 в тиыны, этапы с отчётом или фото —
-- в «Ход работ», для идущих сделок — операции журнала (тестовые), чтобы блок денег совпадал со статусом.

-- ─── новые перечисления ──────────────────────────────────────────────────────
CREATE TYPE "KycStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');
CREATE TYPE "PaymentProviderKind" AS ENUM ('MOCK', 'MANUAL', 'FREEDOMPAY');
CREATE TYPE "ProposalStatus" AS ENUM ('PROPOSED', 'SUPERSEDED', 'WITHDRAWN', 'ACCEPTED');
CREATE TYPE "DisputeOutcome" AS ENUM ('CONTINUE', 'FULL_REFUND', 'PARTIAL_SPLIT');
CREATE TYPE "MoneyTransactionType" AS ENUM ('HOLD', 'FREEZE', 'UNFREEZE', 'RELEASE', 'SPLIT_MASTER', 'SPLIT_PLATFORM', 'REFUND');
CREATE TYPE "MoneyTransactionStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- ─── статусы сделки ТЗ п. 9 ──────────────────────────────────────────────────
CREATE TYPE "DealStatus_new" AS ENUM ('CREATED', 'PAID_HOLD', 'IN_PROGRESS', 'READY', 'ACCEPTED', 'SPLIT_PAYOUT', 'CANCELLED', 'REFUNDED');
ALTER TABLE "Deal" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Deal" ALTER COLUMN "status" TYPE "DealStatus_new" USING (
  CASE "status"::text
    WHEN 'AWAITING_SIGNATURES' THEN 'CREATED'
    WHEN 'AWAITING_DEPOSIT' THEN 'CREATED'
    WHEN 'IN_PROGRESS' THEN 'IN_PROGRESS'
    WHEN 'DISPUTE' THEN 'IN_PROGRESS' -- спор остаётся открытым в Dispute
    WHEN 'COMPLETED' THEN 'SPLIT_PAYOUT'
    WHEN 'CANCELLED' THEN 'CANCELLED'
    WHEN 'TERMINATED' THEN 'REFUNDED'
  END
)::"DealStatus_new";
ALTER TYPE "DealStatus" RENAME TO "DealStatus_old";
ALTER TYPE "DealStatus_new" RENAME TO "DealStatus";
DROP TYPE "DealStatus_old";
ALTER TABLE "Deal" ALTER COLUMN "status" SET DEFAULT 'CREATED';

-- ─── документы: акты этапов уходят из пути продукта ──────────────────────────
DELETE FROM "Document" WHERE "kind"::text = 'STAGE_ACT';
CREATE TYPE "DocumentKind_new" AS ENUM ('CONTRACT', 'ACCEPTANCE_ACT', 'MONEY_STATEMENT', 'RELEASE_RECEIPT');
ALTER TABLE "Document" ALTER COLUMN "kind" TYPE "DocumentKind_new" USING ("kind"::text::"DocumentKind_new");
ALTER TYPE "DocumentKind" RENAME TO "DocumentKind_old";
ALTER TYPE "DocumentKind_new" RENAME TO "DocumentKind";
DROP TYPE "DocumentKind_old";
ALTER TABLE "Document" DROP CONSTRAINT "Document_stageId_fkey";
ALTER TABLE "Document" DROP COLUMN "stageId";

-- ─── файлы: отчёты этапов → «Ход работ» ──────────────────────────────────────
CREATE TYPE "FilePurpose_new" AS ENUM ('PORTFOLIO', 'REQUEST_ROOM', 'PROGRESS_REPORT', 'DELIVERY', 'DISPUTE', 'MESSAGE', 'DOCUMENT', 'VISUALIZATION', 'KYC_ID', 'KYC_REGISTRATION', 'BANK_DOCUMENT', 'HAND_SIGNATURE');
ALTER TABLE "StoredFile" ALTER COLUMN "purpose" TYPE "FilePurpose_new" USING (
  CASE "purpose"::text WHEN 'STAGE_REPORT' THEN 'PROGRESS_REPORT' ELSE "purpose"::text END
)::"FilePurpose_new";
ALTER TYPE "FilePurpose" RENAME TO "FilePurpose_old";
ALTER TYPE "FilePurpose_new" RENAME TO "FilePurpose";
DROP TYPE "FilePurpose_old";

CREATE TABLE "ProgressReport" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "text" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressReport_pkey" PRIMARY KEY ("id")
);

-- Отчёт переносится, если у этапа был текст или фото; id отчёта = id этапа, поэтому фото переносятся по stageId.
INSERT INTO "ProgressReport" ("id", "dealId", "authorId", "title", "text", "createdAt")
SELECT s."id", s."dealId", ep."userId", s."title", COALESCE(s."report", ''), COALESCE(s."submittedAt", s."startedAt", d."createdAt")
FROM "Stage" s
JOIN "Deal" d ON d."id" = s."dealId"
JOIN "ExecutorProfile" ep ON ep."id" = d."executorId"
WHERE s."report" IS NOT NULL OR EXISTS (SELECT 1 FROM "StoredFile" f WHERE f."stageId" = s."id");

ALTER TABLE "StoredFile" ADD COLUMN "progressReportId" TEXT,
ADD COLUMN "dealId" TEXT,
ADD COLUMN "executorProfileId" TEXT;
UPDATE "StoredFile" SET "progressReportId" = "stageId" WHERE "stageId" IS NOT NULL;
ALTER TABLE "StoredFile" DROP CONSTRAINT "StoredFile_stageId_fkey";
ALTER TABLE "StoredFile" DROP COLUMN "stageId";

-- ─── пользователи, мастера, заявки ───────────────────────────────────────────
ALTER TABLE "User" ADD COLUMN "instagram" TEXT;

ALTER TABLE "ExecutorProfile" ADD COLUMN "kycRejectReason" TEXT,
ADD COLUMN "kycReviewedAt" TIMESTAMP(3),
ADD COLUMN "kycStatus" "KycStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "payoutIbanEnc" TEXT,
ADD COLUMN "payoutIbanLast4" TEXT;

ALTER TABLE "Request" ADD COLUMN "addressLat" DOUBLE PRECISION,
ADD COLUMN "addressLng" DOUBLE PRECISION;
ALTER TABLE "Request" ADD CONSTRAINT "Request_address_coords" CHECK (
  ("addressLat" IS NULL) = ("addressLng" IS NULL)
  AND ("addressLat" IS NULL OR ("addressLat" BETWEEN -90 AND 90 AND "addressLng" BETWEEN -180 AND 180))
);

-- Цена отклика — в тиыны.
ALTER TABLE "Offer" ADD COLUMN "priceTiyn" BIGINT;
UPDATE "Offer" SET "priceTiyn" = "price"::BIGINT * 100;
ALTER TABLE "Offer" ALTER COLUMN "priceTiyn" SET NOT NULL;
ALTER TABLE "Offer" DROP COLUMN "price";
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_price_positive" CHECK ("priceTiyn" > 0);

-- ─── сделка: деньги в тиынах по формулам ТЗ п. 6 ────────────────────────────
ALTER TABLE "Deal" ADD COLUMN "priceTiyn" BIGINT,
ADD COLUMN "protectionTiyn" BIGINT,
ADD COLUMN "buyerTotalTiyn" BIGINT,
ADD COLUMN "guaranteeTiyn" BIGINT,
ADD COLUMN "payoutTiyn" BIGINT,
ADD COLUMN "platformIncomeTiyn" BIGINT,
ADD COLUMN "durationDays" INTEGER,
ADD COLUMN "warrantyMonths" INTEGER,
ADD COLUMN "paymentProvider" "PaymentProviderKind",
ADD COLUMN "isDemo" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "paidAt" TIMESTAMP(3),
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "readyAt" TIMESTAMP(3),
ADD COLUMN "acceptedAt" TIMESTAMP(3),
ADD COLUMN "cancelledAt" TIMESTAMP(3),
ADD COLUMN "readyLat" DOUBLE PRECISION,
ADD COLUMN "readyLng" DOUBLE PRECISION,
ADD COLUMN "readyAccuracyM" INTEGER,
ADD COLUMN "readyDistanceM" INTEGER,
ADD COLUMN "readyWithinRadius" BOOLEAN,
ADD COLUMN "publicId" TEXT;

-- Защита — вверх до тиына, выплата — вниз (payments/money.ts); тиыны положительные, деление целочисленное.
UPDATE "Deal" d SET
  "priceTiyn" = d."totalAmount"::BIGINT * 100,
  "protectionTiyn" = (d."totalAmount"::BIGINT * 100 * 2 + 99) / 100,
  "payoutTiyn" = (d."totalAmount"::BIGINT * 100 * 96) / 100,
  "durationDays" = o."durationDays",
  "warrantyMonths" = o."warrantyMonths",
  -- до ТЗ денег через банк в пилоте не было: всё прежнее — тестовые деньги
  "paymentProvider" = 'MOCK',
  "isDemo" = u."isDemo",
  "paidAt" = CASE WHEN d."status" <> 'CREATED' AND d."status" <> 'CANCELLED' THEN d."signedAt" END,
  "startedAt" = CASE WHEN d."status" <> 'CREATED' AND d."status" <> 'CANCELLED' THEN d."signedAt" END,
  "cancelledAt" = CASE WHEN d."status" IN ('CANCELLED', 'REFUNDED') THEN COALESCE(d."closedAt", d."updatedAt") END
FROM "Offer" o, "User" u
WHERE o."id" = d."offerId" AND u."id" = d."clientId";
UPDATE "Deal" SET
  "buyerTotalTiyn" = "priceTiyn" + "protectionTiyn",
  "guaranteeTiyn" = "priceTiyn" - "payoutTiyn",
  "platformIncomeTiyn" = "priceTiyn" + "protectionTiyn" - "payoutTiyn";

ALTER TABLE "Deal" ALTER COLUMN "priceTiyn" SET NOT NULL,
ALTER COLUMN "protectionTiyn" SET NOT NULL,
ALTER COLUMN "buyerTotalTiyn" SET NOT NULL,
ALTER COLUMN "guaranteeTiyn" SET NOT NULL,
ALTER COLUMN "payoutTiyn" SET NOT NULL,
ALTER COLUMN "platformIncomeTiyn" SET NOT NULL,
ALTER COLUMN "durationDays" SET NOT NULL,
ALTER COLUMN "warrantyMonths" SET NOT NULL,
ALTER COLUMN "paymentProvider" SET NOT NULL;
ALTER TABLE "Deal" DROP COLUMN "autoAcceptDays",
DROP COLUMN "closedAt",
DROP COLUMN "paymentMode",
DROP COLUMN "stageTemplate",
DROP COLUMN "totalAmount";

-- Формулы ТЗ п. 6 держит и база: «оплачено = выплата + доход платформы» до тиына.
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_money_formula" CHECK (
  "priceTiyn" > 0
  AND "protectionTiyn" >= 0 AND "payoutTiyn" >= 0
  AND "buyerTotalTiyn" = "priceTiyn" + "protectionTiyn"
  AND "guaranteeTiyn" = "priceTiyn" - "payoutTiyn"
  AND "buyerTotalTiyn" = "payoutTiyn" + "platformIncomeTiyn"
);
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_ready_coords" CHECK (("readyLat" IS NULL) = ("readyLng" IS NULL));
CREATE UNIQUE INDEX "Deal_publicId_key" ON "Deal"("publicId");

-- ─── спор ────────────────────────────────────────────────────────────────────
ALTER TABLE "Dispute" ADD COLUMN "openedInStatus" "DealStatus",
ADD COLUMN "outcome" "DisputeOutcome",
ADD COLUMN "masterShareTiyn" BIGINT;
UPDATE "Dispute" SET "openedInStatus" = 'IN_PROGRESS',
  "outcome" = CASE "decision"::text
    WHEN 'TERMINATE' THEN 'FULL_REFUND'
    WHEN 'PARTIAL' THEN 'PARTIAL_SPLIT'
    ELSE 'CONTINUE'
  END::"DisputeOutcome",
  "masterShareTiyn" = CASE WHEN "decision"::text = 'PARTIAL' THEN "decisionAmount"::BIGINT * 100 END;
UPDATE "Dispute" SET "outcome" = NULL WHERE "decision" IS NULL;
ALTER TABLE "Dispute" ALTER COLUMN "openedInStatus" SET NOT NULL;
ALTER TABLE "Dispute" DROP CONSTRAINT "Dispute_stageId_fkey";
ALTER TABLE "Dispute" DROP COLUMN "decision",
DROP COLUMN "decisionAmount",
DROP COLUMN "stageId";
-- Спор открывается с PAID_HOLD по READY; одновременно открыт не больше одного на сделку.
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_opened_in_status" CHECK ("openedInStatus" IN ('PAID_HOLD', 'IN_PROGRESS', 'READY'));
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_partial_share" CHECK (
  ("outcome" = 'PARTIAL_SPLIT') = ("masterShareTiyn" IS NOT NULL) AND ("masterShareTiyn" IS NULL OR "masterShareTiyn" >= 0)
);
CREATE UNIQUE INDEX "Dispute_one_open_per_deal" ON "Dispute"("dealId") WHERE "status" = 'OPEN';

-- ─── аудит: откуда ───────────────────────────────────────────────────────────
ALTER TABLE "AuditEvent" ADD COLUMN "ip" TEXT,
ADD COLUMN "userAgent" TEXT;

-- ─── старые платёжные сущности (режим MANUAL по этапам, симулятор эскроу) ────
ALTER TABLE "Stage" DROP CONSTRAINT "Stage_dealId_fkey";
ALTER TABLE "StagePayment" DROP CONSTRAINT "StagePayment_stageId_fkey";
ALTER TABLE "EscrowAccount" DROP CONSTRAINT "EscrowAccount_dealId_fkey";
ALTER TABLE "PaymentOperation" DROP CONSTRAINT "PaymentOperation_dealId_fkey";
DROP TABLE "StagePayment";
DROP TABLE "Stage";
DROP TABLE "EscrowAccount";
DROP TABLE "PaymentOperation";
DROP TABLE "BankWebhookEvent";
DROP TYPE "PaymentMode";
DROP TYPE "StageStatus";
DROP TYPE "PaymentDue";
DROP TYPE "StagePaymentStatus";
DROP TYPE "DisputeDecision";
DROP TYPE "EscrowStatus";
DROP TYPE "PaymentOperationKind";
DROP TYPE "PaymentOperationStatus";

-- CreateTable
CREATE TABLE "PriceProposal" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "party" "SignParty" NOT NULL,
    "amountTiyn" BIGINT NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,

    CONSTRAINT "PriceProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DealPublicConsent" (
    "id" TEXT NOT NULL,
    "dealId" TEXT NOT NULL,
    "party" "SignParty" NOT NULL,
    "userId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "DealPublicConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Grade" (
    "executorId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "completedOrdersCount" INTEGER NOT NULL DEFAULT 0,
    "advancePercent" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Grade_pkey" PRIMARY KEY ("executorId")
);

-- CreateTable
CREATE TABLE "MoneyTransaction" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "dealId" TEXT NOT NULL,
    "type" "MoneyTransactionType" NOT NULL,
    "status" "MoneyTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "amountTiyn" BIGINT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "disputeId" TEXT,
    "externalRef" TEXT,
    "basisDocumentId" TEXT,
    "bankDocNumber" TEXT,
    "bankDocDate" TIMESTAMP(3),
    "bankDocFileId" TEXT,
    "actorId" TEXT,
    "confirmedById" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "MoneyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProviderKind" NOT NULL,
    "externalEventId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandSignature" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "party" "SignParty" NOT NULL,
    "imageFileId" TEXT,
    "typedName" TEXT,
    "documentSha256" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PriceProposal_offerId_createdAt_idx" ON "PriceProposal"("offerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressReport_dealId_createdAt_idx" ON "ProgressReport"("dealId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DealPublicConsent_dealId_party_key" ON "DealPublicConsent"("dealId", "party");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransaction_seq_key" ON "MoneyTransaction"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransaction_idempotencyKey_key" ON "MoneyTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "MoneyTransaction_bankDocFileId_key" ON "MoneyTransaction"("bankDocFileId");

-- CreateIndex
CREATE INDEX "MoneyTransaction_dealId_seq_idx" ON "MoneyTransaction"("dealId", "seq");

-- CreateIndex
CREATE INDEX "MoneyTransaction_status_provider_createdAt_idx" ON "MoneyTransaction"("status", "provider", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_externalEventId_key" ON "PaymentWebhookEvent"("externalEventId");

-- CreateIndex
CREATE UNIQUE INDEX "HandSignature_imageFileId_key" ON "HandSignature"("imageFileId");

-- CreateIndex
CREATE UNIQUE INDEX "HandSignature_documentId_party_key" ON "HandSignature"("documentId", "party");

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressReport" ADD CONSTRAINT "ProgressReport_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPublicConsent" ADD CONSTRAINT "DealPublicConsent_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DealPublicConsent" ADD CONSTRAINT "DealPublicConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Grade" ADD CONSTRAINT "Grade_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "ExecutorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MoneyTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_disputeId_fkey" FOREIGN KEY ("disputeId") REFERENCES "Dispute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_basisDocumentId_fkey" FOREIGN KEY ("basisDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_bankDocFileId_fkey" FOREIGN KEY ("bankDocFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandSignature" ADD CONSTRAINT "HandSignature_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandSignature" ADD CONSTRAINT "HandSignature_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandSignature" ADD CONSTRAINT "HandSignature_imageFileId_fkey" FOREIGN KEY ("imageFileId") REFERENCES "StoredFile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_progressReportId_fkey" FOREIGN KEY ("progressReportId") REFERENCES "ProgressReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoredFile" ADD CONSTRAINT "StoredFile_executorProfileId_fkey" FOREIGN KEY ("executorProfileId") REFERENCES "ExecutorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ─── правила журнала денег и торга ───────────────────────────────────────────
ALTER TABLE "MoneyTransaction" ADD CONSTRAINT "MoneyTransaction_amount_nonnegative" CHECK ("amountTiyn" >= 0);
ALTER TABLE "PriceProposal" ADD CONSTRAINT "PriceProposal_amount_positive" CHECK ("amountTiyn" > 0);
-- В отклике одновременно ждёт ответа не больше одного предложения цены: двойной клик — один эффект.
CREATE UNIQUE INDEX "PriceProposal_one_open_per_offer" ON "PriceProposal"("offerId") WHERE "status" = 'PROPOSED';
ALTER TABLE "HandSignature" ADD CONSTRAINT "HandSignature_image_or_name" CHECK ("imageFileId" IS NOT NULL OR "typedName" IS NOT NULL);

-- Журнал денег только на добавление (ТЗ п. 4.4, п. 11): DELETE запрещён; сумма, тип, сделка, провайдер
-- и ключ не меняются; у операции меняется только итог — и только из PENDING.
-- TRUNCATE (сброс демо, очистка тестовой базы) построчные триггеры не вызывает.
CREATE FUNCTION money_transaction_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'MoneyTransaction is append-only: DELETE is not allowed';
  END IF;
  IF NEW."dealId" <> OLD."dealId" OR NEW."type" <> OLD."type" OR NEW."amountTiyn" <> OLD."amountTiyn"
     OR NEW."idempotencyKey" <> OLD."idempotencyKey" OR NEW."provider" <> OLD."provider"
     OR NEW."seq" <> OLD."seq" OR NEW."createdAt" <> OLD."createdAt" THEN
    RAISE EXCEPTION 'MoneyTransaction is append-only: only the outcome of an operation may change';
  END IF;
  IF OLD."status" <> 'PENDING' AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'MoneyTransaction %: settled operation cannot change status', OLD."idempotencyKey";
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER money_transaction_no_delete_rewrite
  BEFORE UPDATE OR DELETE ON "MoneyTransaction"
  FOR EACH ROW EXECUTE FUNCTION money_transaction_append_only();

-- ─── перенос: журнал для сделок, где деньги уже «внесены» по старой модели ──
-- Все прежние сделки — тестовые (MOCK): операции помечены isTest, суммы — из новых полей сделки.
INSERT INTO "MoneyTransaction" ("id", "dealId", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "createdAt", "settledAt")
SELECT 'mt' || md5('hold:' || d."id"), d."id", 'HOLD', 'SUCCEEDED', d."buyerTotalTiyn", 'hold:' || d."id", 'MOCK', true,
       COALESCE(d."paidAt", d."createdAt"), COALESCE(d."paidAt", d."createdAt")
FROM "Deal" d WHERE d."status" NOT IN ('CREATED', 'CANCELLED')
ORDER BY d."number";

INSERT INTO "MoneyTransaction" ("id", "dealId", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "createdAt", "settledAt")
SELECT 'mt' || md5('release:' || d."id"), d."id", 'RELEASE', 'SUCCEEDED', d."payoutTiyn" + d."platformIncomeTiyn", 'release:' || d."id", 'MOCK', true,
       COALESCE(d."completedAt", d."updatedAt"), COALESCE(d."completedAt", d."updatedAt")
FROM "Deal" d WHERE d."status" = 'SPLIT_PAYOUT'
ORDER BY d."number";

INSERT INTO "MoneyTransaction" ("id", "dealId", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "parentId", "createdAt", "settledAt")
SELECT 'mt' || md5(k.prefix || d."id"), d."id", k.type::"MoneyTransactionType", 'SUCCEEDED', k.amount, k.prefix || d."id", 'MOCK', true,
       'mt' || md5('release:' || d."id"), COALESCE(d."completedAt", d."updatedAt"), COALESCE(d."completedAt", d."updatedAt")
FROM "Deal" d
CROSS JOIN LATERAL (VALUES ('split-master:', 'SPLIT_MASTER', d."payoutTiyn"), ('split-platform:', 'SPLIT_PLATFORM', d."platformIncomeTiyn")) AS k(prefix, type, amount)
WHERE d."status" = 'SPLIT_PAYOUT'
ORDER BY d."number", k.prefix;

INSERT INTO "MoneyTransaction" ("id", "dealId", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "createdAt", "settledAt")
SELECT 'mt' || md5('refund:' || d."id"), d."id", 'REFUND', 'SUCCEEDED', d."buyerTotalTiyn", 'refund:' || d."id", 'MOCK', true,
       COALESCE(d."cancelledAt", d."updatedAt"), COALESCE(d."cancelledAt", d."updatedAt")
FROM "Deal" d WHERE d."status" = 'REFUNDED'
ORDER BY d."number";

INSERT INTO "MoneyTransaction" ("id", "dealId", "type", "status", "amountTiyn", "idempotencyKey", "provider", "isTest", "disputeId", "createdAt", "settledAt")
SELECT 'mt' || md5('freeze:' || x."id"), d."id", 'FREEZE', 'SUCCEEDED', d."payoutTiyn", 'freeze:' || x."id", 'MOCK', true, x."id", x."createdAt", x."createdAt"
FROM "Dispute" x JOIN "Deal" d ON d."id" = x."dealId"
WHERE x."status" = 'OPEN' AND d."status" IN ('PAID_HOLD', 'IN_PROGRESS', 'READY')
ORDER BY x."createdAt";

-- Грейд: уровень 1, счётчик — из завершённых сделок; авансов нет.
INSERT INTO "Grade" ("executorId", "completedOrdersCount", "updatedAt")
SELECT "id", "completedDeals", CURRENT_TIMESTAMP FROM "ExecutorProfile";
