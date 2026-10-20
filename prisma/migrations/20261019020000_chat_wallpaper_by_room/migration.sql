-- O formato anterior guardava um único fundo por usuário, sem identificar a sala.
-- Preserva esse fundo na Sala Geral ao introduzir a chave por usuário e sala.
INSERT INTO "Room" ("id", "name", "createdAt", "updatedAt")
VALUES ('geral', 'Sala Geral', NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "ChatAppearance" ADD COLUMN "roomId" TEXT NOT NULL DEFAULT 'geral';
ALTER TABLE "ChatAppearance" ALTER COLUMN "roomId" DROP DEFAULT;
ALTER TABLE "ChatAppearance" DROP CONSTRAINT "ChatAppearance_pkey";
ALTER TABLE "ChatAppearance" ADD CONSTRAINT "ChatAppearance_pkey" PRIMARY KEY ("userId", "roomId");
ALTER TABLE "ChatAppearance" ADD CONSTRAINT "ChatAppearance_roomId_fkey"
  FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ChatAppearance_roomId_idx" ON "ChatAppearance"("roomId");
