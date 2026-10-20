-- Limpa a biblioteca antiga compartilhada. Mensagens continuam apontando para
-- ChatAsset, preservando as figurinhas já enviadas no histórico.
DELETE FROM "Sticker";
DELETE FROM "StickerPack";

ALTER TABLE "Sticker" ADD COLUMN "sourceAssetId" TEXT;
CREATE UNIQUE INDEX "Sticker_ownerId_sourceAssetId_key" ON "Sticker"("ownerId", "sourceAssetId");
