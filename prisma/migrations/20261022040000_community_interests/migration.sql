-- CreateTable
CREATE TABLE "CommunityInterest" (
    "userId" TEXT NOT NULL,
    "topic" VARCHAR(32) NOT NULL,

    CONSTRAINT "CommunityInterest_pkey" PRIMARY KEY ("userId","topic")
);

-- CreateIndex
CREATE INDEX "CommunityInterest_topic_idx" ON "CommunityInterest"("topic");

-- AddForeignKey
ALTER TABLE "CommunityInterest" ADD CONSTRAINT "CommunityInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
