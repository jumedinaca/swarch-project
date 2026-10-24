-- name: UpdateMessage :one
UPDATE messages
SET
    content = sqlc.arg(content),
    location = ST_SetSRID(
        ST_MakePoint(
            sqlc.arg(longitude)::double precision,
            sqlc.arg(latitude)::double precision
        ),
        4326
    )::geography
WHERE id = sqlc.arg(id)
RETURNING
    id,
    sender_id,
    content,
    ST_Y(location::geometry)::double precision AS latitude,
    ST_X(location::geometry)::double precision AS longitude,
    created_at;
