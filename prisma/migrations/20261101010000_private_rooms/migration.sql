ALTER TABLE "Room" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Room" ADD COLUMN "inviteCode" VARCHAR(64);
CREATE UNIQUE INDEX "Room_inviteCode_key" ON "Room"("inviteCode");
ALTER TYPE "NotificationKind" ADD VALUE 'ROOM_INVITE';
