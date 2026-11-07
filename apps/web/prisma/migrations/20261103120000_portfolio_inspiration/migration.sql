-- Встреча 31.10, п. 2 и 3: «Вдохновение» (подборка площадки, место работы) и портфолио из итоговых фото сделок.
-- Работа из сделки видна заказчикам только при согласии заказчика (Deal.portfolioConsentAt).
-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "portfolioConsentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PortfolioItem" ADD COLUMN     "dealId" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "place" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "PortfolioDealPhoto" (
    "portfolioItemId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "PortfolioDealPhoto_pkey" PRIMARY KEY ("portfolioItemId","fileId")
);

-- CreateIndex
CREATE INDEX "PortfolioDealPhoto_fileId_idx" ON "PortfolioDealPhoto"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "PortfolioItem_dealId_key" ON "PortfolioItem"("dealId");

-- AddForeignKey
ALTER TABLE "PortfolioItem" ADD CONSTRAINT "PortfolioItem_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioDealPhoto" ADD CONSTRAINT "PortfolioDealPhoto_portfolioItemId_fkey" FOREIGN KEY ("portfolioItemId") REFERENCES "PortfolioItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortfolioDealPhoto" ADD CONSTRAINT "PortfolioDealPhoto_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "StoredFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

