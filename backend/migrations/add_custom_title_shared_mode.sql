-- =====================================================================
-- Migration: Shared Inbox de Número Único
-- =====================================================================
-- Objetivos:
--   1. Adicionar campo Contact.customTitle (título manual de exibição)
--   2. Forçar sharedLineMode = true em TODAS as configurações do ControlPanel
--      (registro global + por segmento), tornando o modo compartilhado
--      o comportamento permanente do produto.
-- =====================================================================

-- 1) Contact.customTitle (idempotente)
ALTER TABLE "Contact"
    ADD COLUMN IF NOT EXISTS "customTitle" VARCHAR;

-- 2) Garantir que exista pelo menos um ControlPanel global (segmentId IS NULL).
--    O serviço NestJS já cria sob demanda, mas garantimos aqui.
INSERT INTO "ControlPanel" ("segmentId", "sharedLineMode", "createdAt", "updatedAt")
SELECT NULL, TRUE, NOW(), NOW()
WHERE NOT EXISTS (
    SELECT 1 FROM "ControlPanel" WHERE "segmentId" IS NULL
);

-- 3) Forçar sharedLineMode = TRUE em todos os ControlPanels existentes
UPDATE "ControlPanel"
SET "sharedLineMode" = TRUE,
    "updatedAt" = NOW()
WHERE "sharedLineMode" IS DISTINCT FROM TRUE;

-- 4) (Opcional) Index no customTitle para buscas futuras
-- CREATE INDEX IF NOT EXISTS "Contact_customTitle_idx" ON "Contact" ("customTitle");
