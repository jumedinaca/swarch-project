CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    sender_id UUID NOT NULL,

    content TEXT NOT NULL,

    location GEOGRAPHY(Point, 4326) NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_location
ON messages
USING GIST (location);

CREATE INDEX idx_messages_created_at
ON messages (created_at);

CREATE INDEX idx_messages_sender
ON messages (sender_id);