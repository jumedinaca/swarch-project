-- name: DeleteMessage :one
UPDATE messages
SET
    status = 'DELETED',
    updated_at = now()
WHERE id = sqlc.arg(id)
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
