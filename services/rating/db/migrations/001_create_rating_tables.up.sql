CREATE TABLE IF NOT EXISTS message_ratings (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id UUID NOT NULL,
    user_id    UUID NOT NULL,
    value      SMALLINT NOT NULL CHECK (value IN (-1, 1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Un voto por usuario por mensaje: es la base de la idempotencia del voto.
    UNIQUE (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_rating_stats (
    message_id UUID PRIMARY KEY,
    author_id  UUID NOT NULL,
    likes      INTEGER NOT NULL DEFAULT 0 CHECK (likes >= 0),
    dislikes   INTEGER NOT NULL DEFAULT 0 CHECK (dislikes >= 0),
    -- score = likes - dislikes
    score      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Proyeccion local messageId -> authorId construida a partir de los eventos
-- message.published.v1 y message.deleted.v1.
CREATE TABLE IF NOT EXISTS message_projection (
    message_id   UUID PRIMARY KEY,
    author_id    UUID NOT NULL,
    status       VARCHAR(16) NOT NULL CHECK (status IN ('PUBLISHED', 'BLOCKED', 'DELETED')),
    published_at TIMESTAMPTZ NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- message_id ya esta cubierto por el indice de UNIQUE (message_id, user_id),
-- pero se deja explicito como en el diseno.
CREATE INDEX IF NOT EXISTS idx_message_ratings_message ON message_ratings (message_id);
CREATE INDEX IF NOT EXISTS idx_message_ratings_user ON message_ratings (user_id);
CREATE INDEX IF NOT EXISTS idx_rating_stats_score ON message_rating_stats (score DESC);
