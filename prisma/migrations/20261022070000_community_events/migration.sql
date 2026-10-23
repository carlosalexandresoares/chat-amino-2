CREATE TYPE "CommunityEventType" AS ENUM ('PROJECTION', 'ANIME', 'TOURNAMENT', 'QUIZ', 'MEETUP', 'CUSTOM');
CREATE TYPE "CommunityEventStatus" AS ENUM ('SCHEDULED', 'CANCELLED');

CREATE TABLE "CommunityEvent" (
  "id" TEXT NOT NULL,
  "roomId" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "organizerId" TEXT NOT NULL,
  "type" "CommunityEventType" NOT NULL,
  "status" "CommunityEventStatus" NOT NULL DEFAULT 'SCHEDULED',
  "title" VARCHAR(120) NOT NULL,
  "description" VARCHAR(2000) NOT NULL,
  "coverUrl" VARCHAR(1000),
  "startsAt" TIMESTAMP(3) NOT NULL,
  "timeZone" VARCHAR(64) NOT NULL,
  "capacity" INTEGER,
  "registrationOpen" BOOLEAN NOT NULL DEFAULT true,
  "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CommunityEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CommunityEvent_capacity_positive" CHECK ("capacity" IS NULL OR "capacity" BETWEEN 1 AND 10000)
);
CREATE INDEX "CommunityEvent_status_startsAt_id_idx" ON "CommunityEvent"("status","startsAt","id");
CREATE INDEX "CommunityEvent_roomId_startsAt_id_idx" ON "CommunityEvent"("roomId","startsAt","id");
CREATE INDEX "CommunityEvent_organizerId_startsAt_idx" ON "CommunityEvent"("organizerId","startsAt");
ALTER TABLE "CommunityEvent" ADD CONSTRAINT "CommunityEvent_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityEvent" ADD CONSTRAINT "CommunityEvent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunityEvent" ADD CONSTRAINT "CommunityEvent_organizerId_fkey" FOREIGN KEY ("organizerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "EventParticipant" (
  "eventId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reminderEnabled" BOOLEAN NOT NULL DEFAULT true,
  "remindedVersion" INTEGER,
  CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("eventId","userId")
);
CREATE INDEX "EventParticipant_userId_joinedAt_idx" ON "EventParticipant"("userId","joinedAt");
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "CommunityEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
