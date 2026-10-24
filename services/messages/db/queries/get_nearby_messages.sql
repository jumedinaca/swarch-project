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
    m.created_at
FROM messages m, point p
WHERE ST_DWithin(m.location, p.location, sqlc.arg(radius)::double precision)
ORDER BY ST_Distance(m.location, p.location);
