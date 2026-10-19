CREATE TYPE "MessageType" AS ENUM ('TEXT', 'AUDIO', 'STICKER');
CREATE TYPE "ChatAssetKind" AS ENUM ('AUDIO', 'STICKER', 'WALLPAPER');

ALTER TABLE "Message" ADD COLUMN "type" "MessageType" NOT NULL DEFAULT 'TEXT',
  ADD COLUMN "mediaId" TEXT, ADD COLUMN "replyToId" TEXT, ADD COLUMN "deletedAt" TIMESTAMP(3);
ALTER TABLE "Message" ALTER COLUMN "content" SET DEFAULT '';

CREATE TABLE "ChatAsset" (
  "id" TEXT NOT NULL, "key" TEXT NOT NULL, "kind" "ChatAssetKind" NOT NULL,
  "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "duration" DOUBLE PRECISION,
  "ownerId" TEXT NOT NULL, "roomId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ChatAsset_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MessageReaction" (
  "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "emoji" TEXT NOT NULL,
  CONSTRAINT "MessageReaction_pkey" PRIMARY KEY ("messageId", "userId")
);
CREATE TABLE "StickerPack" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StickerPack_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "Sticker" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "ownerId" TEXT NOT NULL,
  "assetId" TEXT NOT NULL, "packId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Sticker_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "StickerFavorite" (
  "userId" TEXT NOT NULL, "stickerId" TEXT NOT NULL,
  CONSTRAINT "StickerFavorite_pkey" PRIMARY KEY ("userId", "stickerId")
);
CREATE TABLE "ChatAppearance" (
  "userId" TEXT NOT NULL, "mode" TEXT NOT NULL DEFAULT 'DEFAULT', "color" TEXT,
  "preset" TEXT, "assetId" TEXT, "positionX" INTEGER NOT NULL DEFAULT 50,
  "positionY" INTEGER NOT NULL DEFAULT 50, "darkness" INTEGER NOT NULL DEFAULT 0,
  "overlay" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ChatAppearance_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "ChatAsset_key_key" ON "ChatAsset"("key");
CREATE INDEX "ChatAsset_ownerId_createdAt_idx" ON "ChatAsset"("ownerId", "createdAt");
CREATE INDEX "Message_roomId_id_idx" ON "Message"("roomId", "id");
CREATE INDEX "Message_replyToId_idx" ON "Message"("replyToId");
CREATE INDEX "StickerPack_ownerId_idx" ON "StickerPack"("ownerId");
CREATE UNIQUE INDEX "Sticker_assetId_key" ON "Sticker"("assetId");
CREATE INDEX "Sticker_ownerId_createdAt_idx" ON "Sticker"("ownerId", "createdAt");

ALTER TABLE "Message" ADD CONSTRAINT "Message_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "ChatAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Message" ADD CONSTRAINT "Message_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MessageReaction" ADD CONSTRAINT "MessageReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAsset" ADD CONSTRAINT "ChatAsset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickerPack" ADD CONSTRAINT "StickerPack_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ChatAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Sticker" ADD CONSTRAINT "Sticker_packId_fkey" FOREIGN KEY ("packId") REFERENCES "StickerPack"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "StickerFavorite" ADD CONSTRAINT "StickerFavorite_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StickerFavorite" ADD CONSTRAINT "StickerFavorite_stickerId_fkey" FOREIGN KEY ("stickerId") REFERENCES "Sticker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAppearance" ADD CONSTRAINT "ChatAppearance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatAppearance" ADD CONSTRAINT "ChatAppearance_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "ChatAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
