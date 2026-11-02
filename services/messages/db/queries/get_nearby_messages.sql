-- name: GetNearbyMessages :many
WITH point AS (
    SELECT ST_SetSRID(
        ST_MakePoint(
            sqlc.arg(longitude)::double precision,
            sqlc.arg(latitude)::double precision
        ),
        4326
    )::geography AS location
)
SELECT
    m.id,
    m.sender_id,
    m.content,
    ST_Y(m.location::geometry)::double precision AS latitude,
    ST_X(m.location::geometry)::double precision AS longitude,
    m.status,
    COALESCE(m.moderation_status, '') AS moderation_status,
    COALESCE(m.moderation_reason, '') AS moderation_reason,
    m.version,
    m.created_at,
    m.updated_at
FROM messages m, point p
WHERE m.status = 'PUBLISHED'
  AND ST_DWithin(m.location, p.location, sqlc.arg(radius)::double precision)
ORDER BY ST_Distance(m.location, p.location);
