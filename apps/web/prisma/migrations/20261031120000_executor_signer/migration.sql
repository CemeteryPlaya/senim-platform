-- Подписант договора от исполнителя — свойство профиля, а не аккаунта (ADR-003).
-- ТОО: ФИО и ИИН директора; ИП и самозанятый: ФИО владельца (его ИИН — binIin*).
-- Уникального индекса на ИИН подписанта нет: один человек может быть директором нескольких ТОО.
-- Колонки nullable: ключ шифрования и HMAC есть только в приложении, старые строки SQL-ом не заполнить.
ALTER TABLE "ExecutorProfile" ADD COLUMN "signerFullName" TEXT;
ALTER TABLE "ExecutorProfile" ADD COLUMN "signerIinEnc" TEXT;
ALTER TABLE "ExecutorProfile" ADD COLUMN "signerIinHash" TEXT;
