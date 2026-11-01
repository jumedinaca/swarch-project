CREATE TABLE IF NOT EXISTS user_reputation (
  user_id           UUID PRIMARY KEY,
  score             INTEGER NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  level             VARCHAR(32) NOT NULL DEFAULT 'Novato',
  likes_received    INTEGER NOT NULL DEFAULT 0,
  dislikes_received INTEGER NOT NULL DEFAULT 0,
  messages_blocked  INTEGER NOT NULL DEFAULT 0,
  messages_warned   INTEGER NOT NULL DEFAULT 0,
  version           INTEGER NOT NULL DEFAULT 0,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reputation_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL,
  delta           INTEGER NOT NULL,
  applied_delta   INTEGER NOT NULL,
  reason          VARCHAR(32) NOT NULL,
  source_event_id UUID NOT NULL,
  dedupe_key      VARCHAR(160) NOT NULL,
  score_after     INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (source_event_id),
  UNIQUE (user_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_reputation_ledger_user_created
  ON reputation_ledger (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_reputation_score
  ON user_reputation (score DESC, updated_at DESC);
