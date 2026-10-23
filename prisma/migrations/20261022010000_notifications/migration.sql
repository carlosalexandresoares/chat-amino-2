CREATE TYPE "NotificationCategory" AS ENUM ('SOCIAL', 'CHAT', 'DIRECT', 'PROJECTION', 'EVENT', 'ACHIEVEMENT', 'ADMIN');
CREATE TYPE "NotificationKind" AS ENUM ('FOLLOW', 'POST_LIKE', 'POST_COMMENT', 'POST_FEATURED', 'CHAT_REPLY', 'MENTION', 'DIRECT_MESSAGE', 'PROJECTION_START', 'EVENT_REMINDER', 'ACHIEVEMENT_UNLOCKED', 'ADMIN_WARNING');

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "recipientId" TEXT NOT NULL,
  "actorId" TEXT,
  "category" "NotificationCategory" NOT NULL,
  "kind" "NotificationKind" NOT NULL,
  "sourceKey" VARCHAR(160) NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "body" VARCHAR(240) NOT NULL,
  "href" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "readAt" TIMESTAMP(3),
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Notification_sourceKey_key" ON "Notification"("sourceKey");
CREATE INDEX "Notification_recipientId_createdAt_id_idx" ON "Notification"("recipientId", "createdAt", "id");
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");
CREATE INDEX "Notification_recipientId_category_createdAt_idx" ON "Notification"("recipientId", "category", "createdAt");

CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL,
  "category" "NotificationCategory" NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "pushEnabled" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId", "category"),
  CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PushSubscription" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "endpoint" VARCHAR(2048) NOT NULL,
  "p256dh" VARCHAR(256) NOT NULL,
  "auth" VARCHAR(256) NOT NULL,
  "deviceLabel" VARCHAR(120),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_createdAt_idx" ON "PushSubscription"("userId", "createdAt");
