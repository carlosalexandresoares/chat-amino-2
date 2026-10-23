CREATE TYPE "VoiceRoomStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TABLE "VoiceRoom" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "name" VARCHAR(60) NOT NULL,
  "status" "VoiceRoomStatus" NOT NULL DEFAULT 'OPEN',
  "linkedLiveId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "VoiceRoom_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "VoiceRoom_roomId_status_createdAt_idx" ON "VoiceRoom"("roomId","status","createdAt");
CREATE INDEX "VoiceRoom_linkedLiveId_idx" ON "VoiceRoom"("linkedLiveId");
ALTER TABLE "VoiceRoom" ADD CONSTRAINT "VoiceRoom_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceRoom" ADD CONSTRAINT "VoiceRoom_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VoiceRoom" ADD CONSTRAINT "VoiceRoom_linkedLiveId_fkey" FOREIGN KEY ("linkedLiveId") REFERENCES "LiveSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
