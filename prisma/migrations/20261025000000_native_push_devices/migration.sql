CREATE TABLE "NativePushDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" VARCHAR(10) NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NativePushDevice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "NativePushDevice_token_key" ON "NativePushDevice"("token");
CREATE INDEX "NativePushDevice_userId_createdAt_idx" ON "NativePushDevice"("userId", "createdAt");
ALTER TABLE "NativePushDevice" ADD CONSTRAINT "NativePushDevice_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
