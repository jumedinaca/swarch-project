-- 002: completa el esquema de moderación en bases creadas con la primera
-- versión de 001.
--
-- La migración 001 se amplió después de haber sido aplicada en algunos entornos
-- (se agregaron status, moderation_status, moderation_reason, version y
-- updated_at). Como golang-migrate no vuelve a ejecutar una versión ya aplicada,
-- esta migración reconcilia esas bases de forma idempotente.
--
-- En una base nueva, 001 ya crea todas las columnas y esta migración no cambia
-- nada.

ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    ADD COLUMN IF NOT EXISTS moderation_status VARCHAR(16),
    ADD COLUMN IF NOT EXISTS moderation_reason TEXT,
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_messages_status'
          AND conrelid = 'messages'::regclass
    ) THEN
        ALTER TABLE messages
            ADD CONSTRAINT chk_messages_status
            CHECK (status IN ('PENDING','PUBLISHED','BLOCKED','DELETED'));
    END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_messages_status
ON messages (status);
