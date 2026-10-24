-- name: CreateMessage :one
INSERT INTO messages (
    sender_id,
    content,
    location
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
    )::geography
)
RETURNING
    id,
    sender_id,
    content,
    ST_Y(location::geometry)::double precision AS latitude,
    ST_X(location::geometry)::double precision AS longitude,
    created_at;
