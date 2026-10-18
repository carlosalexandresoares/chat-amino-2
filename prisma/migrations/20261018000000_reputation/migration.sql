-- Additive migration: existing XP and levels are preserved and remapped to the new thresholds.
CREATE TABLE "XpEvent" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "amount" INTEGER NOT NULL, "reason" TEXT NOT NULL, "sourceKey" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "XpEvent_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "XpEvent_sourceKey_key" ON "XpEvent"("sourceKey");
CREATE INDEX "XpEvent_userId_createdAt_idx" ON "XpEvent"("userId", "createdAt");
CREATE INDEX "XpEvent_reason_createdAt_idx" ON "XpEvent"("reason", "createdAt");
CREATE INDEX "XpEvent_createdAt_userId_idx" ON "XpEvent"("createdAt", "userId");
CREATE INDEX "User_xp_id_idx" ON "User"("xp", "id");
ALTER TABLE "XpEvent" ADD CONSTRAINT "XpEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "Checkin" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "day" DATE NOT NULL, "streak" INTEGER NOT NULL, "reward" INTEGER NOT NULL, CONSTRAINT "Checkin_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Checkin_userId_day_key" ON "Checkin"("userId", "day");
CREATE INDEX "Checkin_userId_day_idx" ON "Checkin"("userId", "day");
ALTER TABLE "Checkin" ADD CONSTRAINT "Checkin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "UserActivity" ("userId" TEXT NOT NULL, "activeSince" TIMESTAMP(3), "lastRealAt" TIMESTAMP(3), "lastPresenceXpAt" TIMESTAMP(3), CONSTRAINT "UserActivity_pkey" PRIMARY KEY ("userId"));
ALTER TABLE "UserActivity" ADD CONSTRAINT "UserActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "PostLike" ("postId" TEXT NOT NULL, "userId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PostLike_pkey" PRIMARY KEY ("postId","userId"));
CREATE INDEX "PostLike_userId_idx" ON "PostLike"("userId");
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Post" ADD COLUMN "featuredAt" TIMESTAMP(3), ADD COLUMN "featuredById" TEXT;
ALTER TABLE "Message" ADD COLUMN "clientKey" TEXT;
CREATE UNIQUE INDEX "Message_clientKey_key" ON "Message"("clientKey");
-- Preserve legacy rank: bring XP up to the new threshold when an existing level is ahead of its XP.
UPDATE "User" SET xp = GREATEST(xp, CASE WHEN level >= 20 THEN 150000 WHEN level = 19 THEN 110000 WHEN level = 18 THEN 83000 WHEN level = 17 THEN 63000 WHEN level = 16 THEN 47000 WHEN level = 15 THEN 35000 WHEN level = 14 THEN 26000 WHEN level = 13 THEN 19000 WHEN level = 12 THEN 14000 WHEN level = 11 THEN 10000 WHEN level = 10 THEN 7000 WHEN level = 9 THEN 5000 WHEN level = 8 THEN 3500 WHEN level = 7 THEN 2300 WHEN level = 6 THEN 1500 WHEN level = 5 THEN 900 WHEN level = 4 THEN 500 WHEN level = 3 THEN 250 WHEN level = 2 THEN 100 ELSE 0 END);
UPDATE "User" SET "level" = CASE WHEN xp >= 150000 THEN 20 WHEN xp >= 110000 THEN 19 WHEN xp >= 83000 THEN 18 WHEN xp >= 63000 THEN 17 WHEN xp >= 47000 THEN 16 WHEN xp >= 35000 THEN 15 WHEN xp >= 26000 THEN 14 WHEN xp >= 19000 THEN 13 WHEN xp >= 14000 THEN 12 WHEN xp >= 10000 THEN 11 WHEN xp >= 7000 THEN 10 WHEN xp >= 5000 THEN 9 WHEN xp >= 3500 THEN 8 WHEN xp >= 2300 THEN 7 WHEN xp >= 1500 THEN 6 WHEN xp >= 900 THEN 5 WHEN xp >= 500 THEN 4 WHEN xp >= 250 THEN 3 WHEN xp >= 100 THEN 2 ELSE 1 END;
-- Existing automatic daily awards remain in XP; mark their local day as claimed to avoid a second award that day.
INSERT INTO "Checkin" ("id", "userId", "day", "streak", "reward")
SELECT 'legacy:' || id || ':' || (("lastDailyXpAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date)::text,
       id, ("lastDailyXpAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Sao_Paulo')::date, 1, 10
FROM "User" WHERE "lastDailyXpAt" IS NOT NULL;
