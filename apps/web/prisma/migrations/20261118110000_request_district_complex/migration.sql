-- Район и жилой комплекс заявки: показываются на публичной странице мастера вместо адреса.
ALTER TABLE "Request" ADD COLUMN "district" TEXT;
ALTER TABLE "Request" ADD COLUMN "complex" TEXT;
