-- Приглашения мастеров к открытому заказу-тендеру: не больше 10 на заявку (лимит — в коде), одно на пару заявка + мастер.

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('INVITED', 'DECLINED', 'OFFERED');

-- CreateTable
CREATE TABLE "RequestInvitation" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "executorId" TEXT NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'INVITED',
    "reason" TEXT,
    "clientKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "RequestInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequestInvitation_executorId_status_idx" ON "RequestInvitation"("executorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "RequestInvitation_requestId_executorId_key" ON "RequestInvitation"("requestId", "executorId");

-- AddForeignKey
ALTER TABLE "RequestInvitation" ADD CONSTRAINT "RequestInvitation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "Request"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestInvitation" ADD CONSTRAINT "RequestInvitation_executorId_fkey" FOREIGN KEY ("executorId") REFERENCES "ExecutorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
