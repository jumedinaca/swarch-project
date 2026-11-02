CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL,

    content TEXT NOT NULL,

    location GEOGRAPHY(Point, 4326) NOT NULL,

    status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    moderation_status VARCHAR(16),
    moderation_reason TEXT,
    version INTEGER NOT NULL DEFAULT 1,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT chk_messages_status
        CHECK (status IN ('PENDING','PUBLISHED','BLOCKED','DELETED'))
);

CREATE INDEX idx_messages_location
ON messages
USING GIST (location);

CREATE INDEX idx_messages_created_at
ON messages (created_at);

CREATE INDEX idx_messages_sender
ON messages (sender_id);

CREATE INDEX idx_messages_status
ON messages (status);
