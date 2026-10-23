-- CreateIndex
CREATE INDEX "DirectMessage_conversationId_senderId_createdAt_idx" ON "DirectMessage"("conversationId", "senderId", "createdAt");

-- CreateIndex
CREATE INDEX "DirectMessage_conversationId_type_createdAt_idx" ON "DirectMessage"("conversationId", "type", "createdAt");
