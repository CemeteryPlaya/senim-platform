-- Уменьшенная копия фото мастера (работа, отчёт, сдача) для карточек и обложек; у старых файлов и PDF — NULL.
ALTER TABLE "StoredFile" ADD COLUMN "previewKey" TEXT;
