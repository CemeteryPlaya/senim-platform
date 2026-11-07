-- Справочник цен материалов и типовые расчёты (ADR-007).
-- CreateTable
CREATE TABLE "MaterialPrice" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "priceKzt" INTEGER NOT NULL,
    "segments" "Segment"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaterialPrice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TypicalEstimate" (
    "furnitureTypeId" TEXT NOT NULL,
    "productUnit" TEXT NOT NULL,
    "typicalWidthCm" INTEGER NOT NULL,
    "typicalHeightCm" INTEGER NOT NULL,
    "markup" DOUBLE PRECISION NOT NULL,
    "perUnit" JSONB NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TypicalEstimate_pkey" PRIMARY KEY ("furnitureTypeId")
);

-- CreateIndex
CREATE INDEX "MaterialPrice_category_active_idx" ON "MaterialPrice"("category", "active");

-- AddForeignKey
ALTER TABLE "MaterialPrice" ADD CONSTRAINT "MaterialPrice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TypicalEstimate" ADD CONSTRAINT "TypicalEstimate_furnitureTypeId_fkey" FOREIGN KEY ("furnitureTypeId") REFERENCES "FurnitureType"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Инварианты справочника, которые не выражаются в schema.prisma: цена положительная, уровень хотя бы один.
ALTER TABLE "MaterialPrice" ADD CONSTRAINT "MaterialPrice_price_positive" CHECK ("priceKzt" > 0);
ALTER TABLE "MaterialPrice" ADD CONSTRAINT "MaterialPrice_segments_nonempty" CHECK ("segments" IS NOT NULL AND cardinality("segments") >= 1);
ALTER TABLE "TypicalEstimate" ADD CONSTRAINT "TypicalEstimate_markup_min" CHECK ("markup" >= 1);
