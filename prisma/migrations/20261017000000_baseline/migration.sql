-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "RoomRole" AS ENUM ('OWNER', 'CO_ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "LiveStatus" AS ENUM ('ACTIVE', 'ENDED');

-- CreateEnum
CREATE TYPE "PlaylistItemStatus" AS ENUM ('WAITING', 'PLAYING', 'PLAYED', 'REMOVED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "avatar" TEXT,
    "banner" TEXT,
    "bio" TEXT,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "level" INTEGER NOT NULL DEFAULT 1,
    "lastDailyXpAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "followerId" TEXT NOT NULL,
    "followedId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("followerId","followedId")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "category" TEXT,
    "avatar" TEXT,
    "banner" TEXT,
    "ownerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomMember" (
    "id" TEXT NOT NULL,
    "role" "RoomRole" NOT NULL DEFAULT 'MEMBER',
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoomMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveSession" (
    "id" TEXT NOT NULL,
    "status" "LiveStatus" NOT NULL DEFAULT 'ACTIVE',
    "currentVideoId" TEXT,
    "currentTime" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "isPlaying" BOOLEAN NOT NULL DEFAULT false,
    "roomId" TEXT NOT NULL,
    "hostId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "LiveSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaylistItem" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "title" TEXT,
    "position" INTEGER NOT NULL,
    "status" "PlaylistItemStatus" NOT NULL DEFAULT 'WAITING',
    "liveId" TEXT NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaylistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Follow_followedId_idx" ON "Follow"("followedId");

-- CreateIndex
CREATE INDEX "Post_userId_createdAt_idx" ON "Post"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Room_slug_key" ON "Room"("slug");

-- CreateIndex
CREATE INDEX "Room_ownerId_idx" ON "Room"("ownerId");

-- CreateIndex
CREATE INDEX "Room_category_idx" ON "Room"("category");

-- CreateIndex
CREATE INDEX "Room_createdAt_idx" ON "Room"("createdAt");

-- CreateIndex
CREATE INDEX "RoomMember_roomId_role_idx" ON "RoomMember"("roomId", "role");

-- CreateIndex
CREATE INDEX "RoomMember_userId_idx" ON "RoomMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "RoomMember_userId_roomId_key" ON "RoomMember"("userId", "roomId");

-- CreateIndex
CREATE INDEX "Message_roomId_createdAt_idx" ON "Message"("roomId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_userId_idx" ON "Message"("userId");

-- CreateIndex
CREATE INDEX "LiveSession_roomId_status_idx" ON "LiveSession"("roomId", "status");

-- CreateIndex
CREATE INDEX "LiveSession_hostId_idx" ON "LiveSession"("hostId");

-- CreateIndex
CREATE INDEX "PlaylistItem_liveId_status_position_idx" ON "PlaylistItem"("liveId", "status", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PlaylistItem_liveId_position_key" ON "PlaylistItem"("liveId", "position");

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followedId_fkey" FOREIGN KEY ("followedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomMember" ADD CONSTRAINT "RoomMember_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LiveSession" ADD CONSTRAINT "LiveSession_hostId_fkey" FOREIGN KEY ("hostId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_liveId_fkey" FOREIGN KEY ("liveId") REFERENCES "LiveSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaylistItem" ADD CONSTRAINT "PlaylistItem_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
