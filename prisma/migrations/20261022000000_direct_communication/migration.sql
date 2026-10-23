CREATE TYPE "DirectStatus" AS ENUM ('PENDING', 'ACTIVE', 'DECLINED');
CREATE TYPE "DirectMessageType" AS ENUM ('TEXT', 'AUDIO', 'STICKER', 'IMAGE');
CREATE TYPE "DirectPrivacy" AS ENUM ('EVERYONE', 'FOLLOWERS', 'FOLLOWING', 'NOBODY');
CREATE TYPE "PresenceStatus" AS ENUM ('ONLINE', 'AWAY', 'BUSY', 'INVISIBLE');
ALTER TYPE "ChatAssetKind" ADD VALUE 'DIRECT_IMAGE';

ALTER TABLE "User" ADD COLUMN "directPrivacy" "DirectPrivacy" NOT NULL DEFAULT 'EVERYONE',
  ADD COLUMN "presenceStatus" "PresenceStatus" NOT NULL DEFAULT 'ONLINE',
  ADD COLUMN "statusText" VARCHAR(100);

CREATE TABLE "UserBlock" (
  "blockerId" TEXT NOT NULL, "blockedId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserBlock_pkey" PRIMARY KEY ("blockerId", "blockedId"),
  CONSTRAINT "UserBlock_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "UserBlock_no_self" CHECK ("blockerId" <> "blockedId")
);
CREATE INDEX "UserBlock_blockedId_idx" ON "UserBlock"("blockedId");

CREATE TABLE "DirectConversation" (
  "id" TEXT NOT NULL, "userAId" TEXT NOT NULL, "userBId" TEXT NOT NULL,
  "requesterId" TEXT NOT NULL, "status" "DirectStatus" NOT NULL DEFAULT 'PENDING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DirectConversation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectConversation_userAId_fkey" FOREIGN KEY ("userAId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectConversation_userBId_fkey" FOREIGN KEY ("userBId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectConversation_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectConversation_pair_order" CHECK ("userAId" < "userBId"),
  CONSTRAINT "DirectConversation_requester_member" CHECK ("requesterId" = "userAId" OR "requesterId" = "userBId")
);
CREATE UNIQUE INDEX "DirectConversation_userAId_userBId_key" ON "DirectConversation"("userAId", "userBId");
CREATE INDEX "DirectConversation_userAId_updatedAt_idx" ON "DirectConversation"("userAId", "updatedAt");
CREATE INDEX "DirectConversation_userBId_updatedAt_idx" ON "DirectConversation"("userBId", "updatedAt");
CREATE INDEX "DirectConversation_status_requesterId_idx" ON "DirectConversation"("status", "requesterId");

CREATE TABLE "DirectSettings" (
  "conversationId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "muted" BOOLEAN NOT NULL DEFAULT false, "pinned" BOOLEAN NOT NULL DEFAULT false,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "DirectSettings_pkey" PRIMARY KEY ("conversationId", "userId"),
  CONSTRAINT "DirectSettings_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectSettings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DirectSettings_userId_archived_pinned_idx" ON "DirectSettings"("userId", "archived", "pinned");

CREATE TABLE "DirectMessage" (
  "id" TEXT NOT NULL, "clientKey" TEXT, "conversationId" TEXT NOT NULL,
  "senderId" TEXT NOT NULL, "type" "DirectMessageType" NOT NULL DEFAULT 'TEXT',
  "content" TEXT NOT NULL DEFAULT '', "mediaId" TEXT, "replyToId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3), "readAt" TIMESTAMP(3), "deletedAt" TIMESTAMP(3),
  CONSTRAINT "DirectMessage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectMessage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ChatAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "DirectMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "DirectMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DirectMessage_clientKey_key" ON "DirectMessage"("clientKey");
CREATE INDEX "DirectMessage_conversationId_createdAt_id_idx" ON "DirectMessage"("conversationId", "createdAt", "id");
CREATE INDEX "DirectMessage_conversationId_senderId_readAt_idx" ON "DirectMessage"("conversationId", "senderId", "readAt");
CREATE INDEX "DirectMessage_replyToId_idx" ON "DirectMessage"("replyToId");

CREATE TABLE "DirectReaction" (
  "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "emoji" TEXT NOT NULL,
  CONSTRAINT "DirectReaction_pkey" PRIMARY KEY ("messageId", "userId"),
  CONSTRAINT "DirectReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "DirectMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ChatMention" (
  "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  CONSTRAINT "ChatMention_pkey" PRIMARY KEY ("messageId", "userId"),
  CONSTRAINT "ChatMention_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ChatMention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ChatMention_userId_idx" ON "ChatMention"("userId");

CREATE TABLE "DirectReport" (
  "id" TEXT NOT NULL, "conversationId" TEXT NOT NULL, "reporterId" TEXT NOT NULL,
  "reason" VARCHAR(40) NOT NULL, "details" VARCHAR(500),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DirectReport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DirectReport_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "DirectConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "DirectReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DirectReport_conversationId_reporterId_key" ON "DirectReport"("conversationId", "reporterId");
CREATE INDEX "DirectReport_createdAt_idx" ON "DirectReport"("createdAt");
