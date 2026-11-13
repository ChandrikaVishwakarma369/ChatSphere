ALTER TABLE "Notification"
ALTER COLUMN "messageId" DROP NOT NULL;

ALTER TABLE "Notification"
ADD COLUMN "callId" TEXT,
ADD COLUMN "type" TEXT NOT NULL DEFAULT 'MESSAGE';

CREATE UNIQUE INDEX "Notification_userId_callId_key" ON "Notification"("userId", "callId");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_callId_fkey"
FOREIGN KEY ("callId") REFERENCES "Call"("callId")
ON DELETE CASCADE ON UPDATE CASCADE;
