-- name: DeleteMessage :execrows
DELETE FROM messages
WHERE id = sqlc.arg(id);
