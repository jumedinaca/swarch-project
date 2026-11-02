package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"rating/internal/domain"
)

type PostgresRatingRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresRatingRepository(pool *pgxpool.Pool) *PostgresRatingRepository {
	return &PostgresRatingRepository{pool: pool}
}

func (r *PostgresRatingRepository) SetVote(ctx context.Context, messageID, raterID uuid.UUID, value domain.Value) (*domain.VoteChange, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// FOR SHARE: un message.deleted concurrente espera a que termine el voto
	// (y viceversa), asi no se vota un mensaje que se acaba de borrar.
	proj, err := scanProjection(tx.QueryRow(ctx, `
		SELECT message_id, author_id, status, published_at
		FROM message_projection
		WHERE message_id = $1
		FOR SHARE`, messageID))
	if err != nil {
		return nil, err
	}
	if err := domain.CheckRateable(proj, raterID); err != nil {
		return nil, err
	}

	// La fila de stats se crea con el primer voto y se bloquea con FOR UPDATE:
	// los votos concurrentes sobre el mismo mensaje se serializan aqui.
	if _, err := tx.Exec(ctx, `
		INSERT INTO message_rating_stats (message_id, author_id)
		VALUES ($1, $2)
		ON CONFLICT (message_id) DO NOTHING`, messageID, proj.AuthorID); err != nil {
		return nil, fmt.Errorf("ensure stats row: %w", err)
	}

	var likes, dislikes int
	if err := tx.QueryRow(ctx, `
		SELECT likes, dislikes
		FROM message_rating_stats
		WHERE message_id = $1
		FOR UPDATE`, messageID).Scan(&likes, &dislikes); err != nil {
		return nil, fmt.Errorf("lock stats row: %w", err)
	}

	// El voto anterior se lee dentro de la transaccion (con stats bloqueada),
	// nunca se deduce del body.
	var ratingID uuid.UUID
	var prevRaw int16
	err = tx.QueryRow(ctx, `
		SELECT id, value
		FROM message_ratings
		WHERE message_id = $1 AND user_id = $2`, messageID, raterID).Scan(&ratingID, &prevRaw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("read previous vote: %w", err)
	}
	prev := domain.Value(prevRaw) // 0 (None) si no habia voto

	change := &domain.VoteChange{
		RatingID:  ratingID,
		MessageID: messageID,
		AuthorID:  proj.AuthorID,
		RaterID:   raterID,
		Previous:  prev,
		Value:     value,
		Likes:     likes,
		Dislikes:  dislikes,
	}

	if prev == value {
		// Mismo voto (o DELETE sin voto): idempotente, nada que escribir.
		return change, nil
	}

	switch {
	case value == domain.None:
		_, err = tx.Exec(ctx, `DELETE FROM message_ratings WHERE id = $1`, ratingID)
	case prev == domain.None:
		err = tx.QueryRow(ctx, `
			INSERT INTO message_ratings (message_id, user_id, value)
			VALUES ($1, $2, $3)
			RETURNING id`, messageID, raterID, int16(value)).Scan(&change.RatingID)
	default:
		_, err = tx.Exec(ctx, `
			UPDATE message_ratings
			SET value = $1, updated_at = now()
			WHERE id = $2`, int16(value), ratingID)
	}
	if err != nil {
		return nil, fmt.Errorf("write vote: %w", err)
	}

	change.Likes, change.Dislikes = domain.ApplyVote(likes, dislikes, prev, value)
	if err := tx.QueryRow(ctx, `
		UPDATE message_rating_stats
		SET likes = $2::int, dislikes = $3::int, score = $2::int - $3::int, updated_at = now()
		WHERE message_id = $1
		RETURNING updated_at`, messageID, change.Likes, change.Dislikes).Scan(&change.ChangedAt); err != nil {
		return nil, fmt.Errorf("update stats: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	change.Changed = true
	return change, nil
}

func (r *PostgresRatingRepository) GetProjection(ctx context.Context, messageID uuid.UUID) (*domain.MessageProjection, error) {
	return scanProjection(r.pool.QueryRow(ctx, `
		SELECT message_id, author_id, status, published_at
		FROM message_projection
		WHERE message_id = $1`, messageID))
}

func (r *PostgresRatingRepository) GetSummaries(ctx context.Context, messageIDs []uuid.UUID, userID uuid.UUID) ([]domain.Summary, error) {
	if len(messageIDs) == 0 {
		return []domain.Summary{}, nil
	}

	rows, err := r.pool.Query(ctx, `
		SELECT ids.id,
		       COALESCE(s.likes, 0),
		       COALESCE(s.dislikes, 0),
		       COALESCE(mr.value, 0)
		FROM unnest($1::uuid[]) WITH ORDINALITY AS ids(id, ord)
		LEFT JOIN message_rating_stats s ON s.message_id = ids.id
		LEFT JOIN message_ratings mr ON mr.message_id = ids.id AND mr.user_id = $2
		ORDER BY ids.ord`, messageIDs, userID)
	if err != nil {
		return nil, fmt.Errorf("query summaries: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Summary, 0, len(messageIDs))
	for rows.Next() {
		var s domain.Summary
		var my int16
		if err := rows.Scan(&s.MessageID, &s.Likes, &s.Dislikes, &my); err != nil {
			return nil, fmt.Errorf("scan summary: %w", err)
		}
		s.MyRating = domain.Value(my)
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate summaries: %w", err)
	}
	return out, nil
}

func (r *PostgresRatingRepository) UpsertPublished(ctx context.Context, messageID, authorID uuid.UUID, publishedAt time.Time) error {
	_, err := r.pool.Exec(ctx, `
		INSERT INTO message_projection (message_id, author_id, status, published_at)
		VALUES ($1, $2, 'PUBLISHED', $3)
		ON CONFLICT (message_id) DO UPDATE SET
			author_id    = EXCLUDED.author_id,
			published_at = EXCLUDED.published_at,
			-- Un borrado nunca se revierte, aunque la publicacion llegue despues.
			status       = CASE WHEN message_projection.status = 'DELETED'
			                    THEN 'DELETED' ELSE 'PUBLISHED' END,
			updated_at   = now()`, messageID, authorID, publishedAt)
	if err != nil {
		return fmt.Errorf("upsert published projection: %w", err)
	}
	return nil
}

func (r *PostgresRatingRepository) MarkDeleted(ctx context.Context, messageID, authorID uuid.UUID, deletedAt time.Time) error {
	// Si el borrado llega antes que la publicacion se deja una lapida con el
	// autor conocido (o uuid nulo); la publicacion posterior solo completa el autor.
	_, err := r.pool.Exec(ctx, `
		INSERT INTO message_projection (message_id, author_id, status, published_at)
		VALUES ($1, $2, 'DELETED', $3)
		ON CONFLICT (message_id) DO UPDATE SET
			status     = 'DELETED',
			updated_at = now()`, messageID, authorID, deletedAt)
	if err != nil {
		return fmt.Errorf("mark projection deleted: %w", err)
	}
	return nil
}

func scanProjection(row pgx.Row) (*domain.MessageProjection, error) {
	var p domain.MessageProjection
	var status string
	err := row.Scan(&p.MessageID, &p.AuthorID, &status, &p.PublishedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query projection: %w", err)
	}
	p.Status = domain.MessageStatus(status)
	return &p, nil
}
