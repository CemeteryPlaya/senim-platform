-- «Лучшие работы» мастера на публичной странице: до 6 (лимит — в коде), работа портфолио или оконченная сделка.

-- CreateTable
CREATE TABLE "ExecutorHighlight" (
    "id" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "portfolioItemId" TEXT,
    "dealId" TEXT,
    "position" INTEGER NOT NULL,

    CONSTRAINT "ExecutorHighlight_pkey" PRIMARY KEY ("id"),
    -- ровно одно из двух: работа портфолио или сделка
    CONSTRAINT "ExecutorHighlight_one_target" CHECK (("portfolioItemId" IS NULL) <> ("dealId" IS NULL))
);

-- CreateIndex
CREATE UNIQUE INDEX "ExecutorHighlight_portfolioItemId_key" ON "ExecutorHighlight"("portfolioItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutorHighlight_dealId_key" ON "ExecutorHighlight"("dealId");

-- CreateIndex
CREATE UNIQUE INDEX "ExecutorHighlight_executorId_position_key" ON "ExecutorHighlight"("executorId", "position");

-- AddForeignKey
ALTER TABLE "ExecutorHighlight" ADD CONSTRAINT "ExecutorHighlight_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "ExecutorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutorHighlight" ADD CONSTRAINT "ExecutorHighlight_portfolioItemId_fkey" FOREIGN KEY ("portfolioItemId") REFERENCES "PortfolioItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExecutorHighlight" ADD CONSTRAINT "ExecutorHighlight_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
