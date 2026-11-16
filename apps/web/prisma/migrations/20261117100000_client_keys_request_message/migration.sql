-- Ключ повтора от клиента (форма v2): повтор первого шага мастера заявки и отправки сообщения отдаёт уже созданную запись.
-- Колонки необязательные: у записей сида и v1 ключа нет (NULL не участвует в уникальности).
ALTER TABLE "Request" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "Request_clientId_clientKey_key" ON "Request"("clientId", "clientKey");

ALTER TABLE "Message" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "Message_senderId_clientKey_key" ON "Message"("senderId", "clientKey");
