-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ACCEPTED', 'COMPLETED', 'MISSED', 'REJECTED', 'CANCELLED', 'FAILED');

-- AlterTable
ALTER TABLE "Message" ALTER COLUMN "deliveredAt" DROP DEFAULT,
ALTER COLUMN "readAt" DROP DEFAULT;

-- CreateTable
CREATE TABLE "Call" (
    "id" SERIAL NOT NULL,
    "callId" TEXT NOT NULL,
    "callerId" INTEGER NOT NULL,
    "receiverId" INTEGER NOT NULL,
    "video" BOOLEAN NOT NULL DEFAULT false,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "duration" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Call_callId_key" ON "Call"("callId");

-- CreateIndex
CREATE INDEX "Call_callerId_receiverId_startedAt_idx" ON "Call"("callerId", "receiverId", "startedAt");

-- CreateIndex
CREATE INDEX "Call_receiverId_callerId_startedAt_idx" ON "Call"("receiverId", "callerId", "startedAt");

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_callerId_fkey" FOREIGN KEY ("callerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Call" ADD CONSTRAINT "Call_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
