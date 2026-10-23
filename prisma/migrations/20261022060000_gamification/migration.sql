CREATE TYPE "MissionCadence" AS ENUM ('DAILY', 'WEEKLY');
CREATE TYPE "CosmeticType" AS ENUM ('FRAME', 'TITLE', 'PROFILE_THEME');
CREATE INDEX "PostLike_userId_createdAt_idx" ON "PostLike"("userId","createdAt");
CREATE INDEX "XpEvent_userId_reason_createdAt_idx" ON "XpEvent"("userId","reason","createdAt");
CREATE INDEX "LiveSession_hostId_status_idx" ON "LiveSession"("hostId","status");
ALTER TABLE "User" ADD COLUMN "coinBalance" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD CONSTRAINT "User_coinBalance_nonnegative" CHECK ("coinBalance" >= 0);

CREATE TABLE "Achievement" (
  "id" VARCHAR(60) NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "metric" VARCHAR(60) NOT NULL,
  "target" INTEGER NOT NULL,
  "medal" VARCHAR(10) NOT NULL,
  "coinReward" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "Achievement_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "UserAchievement" (
  "userId" TEXT NOT NULL,
  "achievementId" VARCHAR(60) NOT NULL,
  "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "coinsClaimedAt" TIMESTAMP(3),
  CONSTRAINT "UserAchievement_pkey" PRIMARY KEY ("userId","achievementId")
);
CREATE INDEX "UserAchievement_unlockedAt_idx" ON "UserAchievement"("unlockedAt");

CREATE TABLE "Mission" (
  "id" VARCHAR(60) NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "metric" VARCHAR(60) NOT NULL,
  "target" INTEGER NOT NULL,
  "coinReward" INTEGER NOT NULL,
  "cadence" "MissionCadence" NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "MissionClaim" (
  "userId" TEXT NOT NULL,
  "missionId" VARCHAR(60) NOT NULL,
  "periodKey" VARCHAR(10) NOT NULL,
  "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MissionClaim_pkey" PRIMARY KEY ("userId","missionId","periodKey")
);
CREATE INDEX "MissionClaim_userId_periodKey_idx" ON "MissionClaim"("userId","periodKey");

CREATE TABLE "CoinTransaction" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "balanceAfter" INTEGER NOT NULL,
  "reason" VARCHAR(60) NOT NULL,
  "sourceKey" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CoinTransaction_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CoinTransaction_sourceKey_key" ON "CoinTransaction"("sourceKey");
CREATE INDEX "CoinTransaction_userId_createdAt_id_idx" ON "CoinTransaction"("userId","createdAt","id");

CREATE TABLE "CosmeticItem" (
  "id" VARCHAR(60) NOT NULL,
  "type" "CosmeticType" NOT NULL,
  "title" VARCHAR(100) NOT NULL,
  "description" VARCHAR(240) NOT NULL,
  "rarity" VARCHAR(30) NOT NULL,
  "cssToken" VARCHAR(60) NOT NULL,
  "price" INTEGER NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "CosmeticItem_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "CosmeticItem" ADD CONSTRAINT "CosmeticItem_price_nonnegative" CHECK ("price" >= 0);
CREATE INDEX "CosmeticItem_active_type_price_idx" ON "CosmeticItem"("active","type","price");
CREATE TABLE "UserInventory" (
  "userId" TEXT NOT NULL,
  "itemId" VARCHAR(60) NOT NULL,
  "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "equipped" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "UserInventory_pkey" PRIMARY KEY ("userId","itemId")
);
CREATE INDEX "UserInventory_userId_equipped_idx" ON "UserInventory"("userId","equipped");

ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserAchievement" ADD CONSTRAINT "UserAchievement_achievementId_fkey" FOREIGN KEY ("achievementId") REFERENCES "Achievement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionClaim" ADD CONSTRAINT "MissionClaim_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MissionClaim" ADD CONSTRAINT "MissionClaim_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoinTransaction" ADD CONSTRAINT "CoinTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInventory" ADD CONSTRAINT "UserInventory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserInventory" ADD CONSTRAINT "UserInventory_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "CosmeticItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "Achievement" ("id","title","description","metric","target","medal","coinReward") VALUES
('first_message','Primeira conversa','Envie uma mensagem válida no chat.','MESSAGES',1,'💬',5),
('first_post','Primeira publicação','Publique seu primeiro post.','POSTS',1,'✍️',5),
('first_community','Fundador de comunidade','Crie sua primeira comunidade.','ROOMS',1,'🏡',10),
('checkin_7','Uma semana presente','Alcance sete dias seguidos de check-in.','CHECKIN_STREAK',7,'🔥',10),
('checkin_30','Presença lendária','Alcance trinta dias seguidos de check-in.','CHECKIN_STREAK',30,'🌟',30),
('messages_100','Voz da comunidade','Envie cem mensagens válidas.','MESSAGES',100,'🗣️',20),
('likes_100','Aplausos da comunidade','Receba cem curtidas em seus posts.','LIKES_RECEIVED',100,'💜',20),
('first_projection','Primeira projeção','Conclua uma projeção como anfitrião.','HOSTED_PROJECTIONS',1,'🎬',10),
('projections_10','Anfitrião lendário','Conclua dez projeções como anfitrião.','HOSTED_PROJECTIONS',10,'📽️',30),
('level_10','Jounin','Alcance o nível 10.','LEVEL',10,'🥋',20),
('level_20','Lenda Shinobi','Alcance o nível 20.','LEVEL',20,'🏆',50);

INSERT INTO "Mission" ("id","title","description","metric","target","coinReward","cadence") VALUES
('daily_checkin','Marcar presença','Faça check-in hoje.','CHECKINS',1,5,'DAILY'),
('daily_message','Participar do chat','Envie uma mensagem válida hoje.','MESSAGES',1,5,'DAILY'),
('daily_post','Compartilhar uma ideia','Publique um post hoje.','POSTS',1,10,'DAILY'),
('daily_like','Apoiar um post','Curta um post de outra pessoa hoje.','LIKES_GIVEN',1,5,'DAILY'),
('weekly_checkins','Presença na semana','Faça check-in em três dias diferentes.','CHECKINS',3,15,'WEEKLY'),
('weekly_post','Publicar na semana','Publique um post nesta semana.','POSTS',1,20,'WEEKLY'),
('weekly_missions','Semana de missões','Colete cinco missões diárias nesta semana.','DAILY_CLAIMS',5,20,'WEEKLY');

INSERT INTO "CosmeticItem" ("id","type","title","description","rarity","cssToken","price") VALUES
('frame-amethyst','FRAME','Moldura ametista','Uma moldura violeta luminosa para o avatar.','RARA','amethyst',25),
('frame-ember','FRAME','Moldura chama','Uma moldura quente para o avatar.','RARA','ember',25),
('title-explorer','TITLE','Explorador','Mostre seu espírito de descoberta no perfil.','COMUM','explorer',15),
('title-guardian','TITLE','Guardião do Clã','Um título especial para quem cuida da comunidade.','ÉPICA','guardian',40),
('theme-aurora','PROFILE_THEME','Aurora violeta','Um tema luminoso para o perfil.','RARA','aurora',30),
('theme-night','PROFILE_THEME','Noite estrelada','Um tema noturno para o perfil.','RARA','night',30);
