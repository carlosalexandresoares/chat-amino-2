CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "ModerationReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'DISMISSED');
CREATE TYPE "CommunitySanctionType" AS ENUM ('MUTE', 'SUSPEND');

ALTER TABLE "User" ADD COLUMN "profileVisibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC';

CREATE TABLE "ModerationReport" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "reporterId" TEXT,
  "kind" VARCHAR(20) NOT NULL,
  "targetId" VARCHAR(100) NOT NULL,
  "subjectUserId" TEXT,
  "roomId" TEXT,
  "reason" VARCHAR(40) NOT NULL,
  "details" VARCHAR(500),
  "evidence" VARCHAR(500),
  "status" "ModerationReportStatus" NOT NULL DEFAULT 'OPEN',
  "resolvedById" TEXT,
  "resolutionNote" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ModerationReport_reporterId_kind_targetId_key" ON "ModerationReport"("reporterId", "kind", "targetId");
CREATE INDEX "ModerationReport_roomId_status_createdAt_idx" ON "ModerationReport"("roomId", "status", "createdAt");
CREATE INDEX "ModerationReport_status_createdAt_idx" ON "ModerationReport"("status", "createdAt");
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationReport" ADD CONSTRAINT "ModerationReport_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ModerationAction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT,
  "targetUserId" TEXT,
  "roomId" TEXT,
  "action" VARCHAR(40) NOT NULL,
  "targetType" VARCHAR(20),
  "targetId" VARCHAR(100),
  "reason" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ModerationAction_roomId_createdAt_idx" ON "ModerationAction"("roomId", "createdAt");
CREATE INDEX "ModerationAction_createdAt_idx" ON "ModerationAction"("createdAt");
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ModerationAction" ADD CONSTRAINT "ModerationAction_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "CommunitySanction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "roomId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "actorId" TEXT,
  "type" "CommunitySanctionType" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "CommunitySanction_roomId_userId_type_expiresAt_idx" ON "CommunitySanction"("roomId", "userId", "type", "expiresAt");
CREATE INDEX "CommunitySanction_expiresAt_idx" ON "CommunitySanction"("expiresAt");
ALTER TABLE "CommunitySanction" ADD CONSTRAINT "CommunitySanction_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunitySanction" ADD CONSTRAINT "CommunitySanction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CommunitySanction" ADD CONSTRAINT "CommunitySanction_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "ModerationReport" ("id", "reporterId", "kind", "targetId", "subjectUserId", "roomId", "reason", "details", "createdAt")
SELECT 'legacy-post-' || p."id", p."reporterId", 'POST', p."postId", post."userId", post."roomId", p."reason", p."details", p."createdAt"
FROM "PostReport" p JOIN "Post" post ON post."id" = p."postId"
ON CONFLICT DO NOTHING;
INSERT INTO "ModerationReport" ("id", "reporterId", "kind", "targetId", "reason", "details", "createdAt")
SELECT 'legacy-dm-' || d."id", d."reporterId", 'DIRECT', d."conversationId", d."reason", d."details", d."createdAt"
FROM "DirectReport" d ON CONFLICT DO NOTHING;
