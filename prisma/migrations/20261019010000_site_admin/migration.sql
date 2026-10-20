ALTER TABLE "User" ADD COLUMN "isSiteAdmin" BOOLEAN NOT NULL DEFAULT false;

-- A conta existente SICK é identificada pelo ID, nunca pelo nome editável.
UPDATE "User" SET "isSiteAdmin" = true WHERE "id" = 'cmrr42w1r0000j2mspul0asjo';
