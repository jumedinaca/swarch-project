-- name: GetMessageByID :one
SELECT
    id,
    sender_id,
    content,
    ST_Y(location::geometry)::double precision AS latitude,
    ST_X(location::geometry)::double precision AS longitude,
    created_at
FROM messages
WHERE id = sqlc.arg(id);
