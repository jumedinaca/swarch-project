-- name: ApplyModerationDecision :one
UPDATE messages
SET
    status = sqlc.arg(status),
    moderation_status = sqlc.arg(moderation_status),
    moderation_reason = NULLIF(sqlc.arg(moderation_reason)::text, ''),
    updated_at = now()
WHERE id = sqlc.arg(id)
  AND version = sqlc.arg(version)
  AND status = 'PENDING'
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
