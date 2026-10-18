CREATE TABLE "UserImage" (
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "data" BYTEA NOT NULL,
  "mimeType" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserImage_pkey" PRIMARY KEY ("userId", "kind")
);

ALTER TABLE "UserImage" ADD CONSTRAINT "UserImage_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
