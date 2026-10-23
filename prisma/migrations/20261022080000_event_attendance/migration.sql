ALTER TABLE "EventParticipant" ADD COLUMN "attendedAt" TIMESTAMP(3);
CREATE INDEX "EventParticipant_userId_attendedAt_idx" ON "EventParticipant"("userId","attendedAt");
INSERT INTO "Achievement" ("id","title","description","metric","target","medal","coinReward") VALUES
('events_20','Presença memorável','Marque presença em vinte eventos.','EVENTS_ATTENDED',20,'🎟️',40);
INSERT INTO "Mission" ("id","title","description","metric","target","coinReward","cadence") VALUES
('weekly_event','Encontrar a comunidade','Marque presença em um evento nesta semana.','EVENTS_ATTENDED',1,20,'WEEKLY');
