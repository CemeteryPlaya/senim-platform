-- Сценарии до договора (ADR-005), часть 2: снимок сценария в заявке, замер площадки, проект,
-- залог за выезд и повторный отклик по разрешению оператора (№16).

-- CreateEnum
CREATE TYPE "PreContractFlow" AS ENUM ('EXECUTOR_MEASURE', 'PLATFORM_MEASURER', 'CONTRACT_FIRST', 'MEASURE_DEPOSIT', 'SELF_MEASURE');

-- CreateEnum
CREATE TYPE "SiteMeasurementStatus" AS ENUM ('ASSIGNED', 'DONE');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('MARKED_PAID', 'CONFIRMED');

-- DropIndex
DROP INDEX "Offer_requestId_executorId_key";

-- AlterTable
ALTER TABLE "Request" ADD COLUMN     "preContractFlow" "PreContractFlow";

-- AlterTable
ALTER TABLE "Offer" ADD COLUMN     "round" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "SiteMeasurement" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "measurerId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "status" "SiteMeasurementStatus" NOT NULL DEFAULT 'ASSIGNED',
    "widthCm" INTEGER,
    "heightCm" INTEGER,
    "depthCm" INTEGER,
    "notes" TEXT NOT NULL DEFAULT '',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteMeasurement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'SUBMITTED',
    "materials" TEXT NOT NULL,
    "costLines" JSONB NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "warrantyMonths" INTEGER NOT NULL,
    "totalPrice" INTEGER NOT NULL,
    "changeNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeasureDeposit" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "DepositStatus" NOT NULL DEFAULT 'MARKED_PAID',
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "MeasureDeposit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfferRetry" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfferRetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SiteMeasurement_requestId_key" ON "SiteMeasurement"("requestId");

-- CreateIndex
CREATE INDEX "SiteMeasurement_measurerId_status_idx" ON "SiteMeasurement"("measurerId", "status");

-- CreateIndex
CREATE INDEX "Project_requestId_idx" ON "Project"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "Project_offerId_version_key" ON "Project"("offerId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "MeasureDeposit_offerId_key" ON "MeasureDeposit"("offerId");

-- CreateIndex
CREATE UNIQUE INDEX "OfferRetry_requestId_executorId_round_key" ON "OfferRetry"("requestId", "executorId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_requestId_executorId_round_key" ON "Offer"("requestId", "executorId", "round");

-- AddForeignKey
ALTER TABLE "SiteMeasurement" ADD CONSTRAINT "SiteMeasurement_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteMeasurement" ADD CONSTRAINT "SiteMeasurement_measurerId_fkey" FOREIGN KEY ("measurerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeasureDeposit" ADD CONSTRAINT "MeasureDeposit_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfferRetry" ADD CONSTRAINT "OfferRetry_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Заявки, отправленные до появления настройки, шли по сценарию 1 (замер исполнителем).
UPDATE "Request" SET "preContractFlow" = 'EXECUTOR_MEASURE' WHERE "status" <> 'DRAFT';

-- Сотрудники площадки (оператор и замерщик) не совмещают роль с другими:
-- оператор решал бы споры в своих сделках, замерщик снимал бы размеры для своей заявки.
ALTER TABLE "User" DROP CONSTRAINT "User_operator_alone";
ALTER TABLE "User" ADD CONSTRAINT "User_staff_alone" CHECK (
  (NOT ('OPERATOR' = ANY ("roles")) OR "roles" = ARRAY['OPERATOR']::"Role"[])
  AND (NOT ('MEASURER' = ANY ("roles")) OR "roles" = ARRAY['MEASURER']::"Role"[])
);

-- Номер попытки отклика — с единицы.
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_round_positive" CHECK ("round" >= 1);
