-- name: CreateMessage :one
INSERT INTO messages (
    sender_id,
    content,
    location,
    status,
    moderation_status,
    version
)
VALUES (
    sqlc.arg(sender_id),
    sqlc.arg(content),
    ST_SetSRID(
        ST_MakePoint(
            sqlc.arg(longitude)::double precision,
            sqlc.arg(latitude)::double precision
        ),
        4326
    )::geography,
    'PENDING',
    'PENDING',
    1
)
RETURNING
    id,
    sender_id,
    content,
    ST_Y(location::geometry)::double precision AS latitude,
    ST_X(location::geometry)::double precision AS longitude,
    status,
    COALESCE(moderation_status, '') AS moderation_status,
    COALESCE(moderation_reason, '') AS moderation_reason,
    version,
    created_at,
    updated_at;
