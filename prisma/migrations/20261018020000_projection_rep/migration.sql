ALTER TABLE "LiveSession"
  ADD COLUMN "roomName" TEXT,
  ADD COLUMN "repTickAt" TIMESTAMP(3),
  ADD COLUMN "hostRepSeconds" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hostRepAccrued" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hostRepCollected" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "participantRepGranted" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "uniqueVisitors" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "peakParticipants" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "messageCount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "ProjectionDay" (
  "userId" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "hostAccrued" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProjectionDay_pkey" PRIMARY KEY ("userId", "day")
);
CREATE TABLE "ProjectionParticipant" (
  "liveId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLeftAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "activeSeconds" INTEGER NOT NULL DEFAULT 0,
  "repGranted" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ProjectionParticipant_pkey" PRIMARY KEY ("liveId", "userId")
);
CREATE TABLE "ProjectionVisit" (
  "id" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leftAt" TIMESTAMP(3),
  CONSTRAINT "ProjectionVisit_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "ProjectionEngagement" (
  "userId" TEXT NOT NULL,
  "liveId" TEXT NOT NULL,
  "confirmedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ProjectionEngagement_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "ProjectionParticipant_userId_idx" ON "ProjectionParticipant"("userId");
CREATE INDEX "ProjectionVisit_liveId_userId_leftAt_idx" ON "ProjectionVisit"("liveId", "userId", "leftAt");

ALTER TABLE "ProjectionDay" ADD CONSTRAINT "ProjectionDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionParticipant" ADD CONSTRAINT "ProjectionParticipant_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionParticipant" ADD CONSTRAINT "ProjectionParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionVisit" ADD CONSTRAINT "ProjectionVisit_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionVisit" ADD CONSTRAINT "ProjectionVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectionEngagement" ADD CONSTRAINT "ProjectionEngagement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
