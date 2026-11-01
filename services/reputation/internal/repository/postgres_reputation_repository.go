package repository

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"

	"reputation/internal/domain"
)

type PostgresReputationRepository struct {
	pool *pgxpool.Pool
}

func NewPostgresReputationRepository(pool *pgxpool.Pool) *PostgresReputationRepository {
	return &PostgresReputationRepository{pool: pool}
}

func (r *PostgresReputationRepository) GetUserReputation(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	query := `
		SELECT user_id, score, level, likes_received, dislikes_received, messages_blocked, messages_warned, version, updated_at
		FROM user_reputation
		WHERE user_id = $1
	`
	row := r.pool.QueryRow(ctx, query, userID)

	var rep domain.UserReputation
	err := row.Scan(
		&rep.UserID,
		&rep.Score,
		&rep.Level,
		&rep.LikesReceived,
		&rep.DislikesReceived,
		&rep.MessagesBlocked,
		&rep.MessagesWarned,
		&rep.Version,
		&rep.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("error querying user reputation: %w", err)
	}

	return &rep, nil
}

func (r *PostgresReputationRepository) HasLedgerDedupeKey(ctx context.Context, userID uuid.UUID, dedupeKey string) (bool, error) {
	query := `
		SELECT 1 FROM reputation_ledger
		WHERE user_id = $1 AND dedupe_key = $2
		LIMIT 1
	`
	var exists int
	err := r.pool.QueryRow(ctx, query, userID, dedupeKey).Scan(&exists)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("error checking dedupe key: %w", err)
	}
	return true, nil
}

func (r *PostgresReputationRepository) ApplyReputationChangeTx(ctx context.Context, params ApplyChangeParams) (*domain.AppliedChange, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin transaction: %w", err)
	}
	defer tx.Rollback(ctx)

	// Check if this source_event_id was already processed
	var existingEventID uuid.UUID
	err = tx.QueryRow(ctx, `SELECT source_event_id FROM reputation_ledger WHERE source_event_id = $1`, params.SourceEventID).Scan(&existingEventID)
	if err == nil {
		return nil, ErrDuplicateEvent
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("error checking source_event_id: %w", err)
	}

	// Check if dedupe_key for this user was already processed
	var existingDedupe uuid.UUID
	err = tx.QueryRow(ctx, `SELECT id FROM reputation_ledger WHERE user_id = $1 AND dedupe_key = $2`, params.UserID, params.DedupeKey).Scan(&existingDedupe)
	if err == nil {
		return nil, ErrDuplicateEvent
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("error checking dedupe_key: %w", err)
	}

	// Ensure row exists in user_reputation
	_, err = tx.Exec(ctx, `
		INSERT INTO user_reputation (user_id, score, level)
		VALUES ($1, 0, 'Novato')
		ON CONFLICT (user_id) DO NOTHING
	`, params.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to ensure user_reputation row: %w", err)
	}

	// Lock the user_reputation row
	var rep domain.UserReputation
	err = tx.QueryRow(ctx, `
		SELECT user_id, score, level, likes_received, dislikes_received, messages_blocked, messages_warned, version, updated_at
		FROM user_reputation
		WHERE user_id = $1
		FOR UPDATE
	`, params.UserID).Scan(
		&rep.UserID,
		&rep.Score,
		&rep.Level,
		&rep.LikesReceived,
		&rep.DislikesReceived,
		&rep.MessagesBlocked,
		&rep.MessagesWarned,
		&rep.Version,
		&rep.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to lock user_reputation: %w", err)
	}

	previousScore := rep.Score
	previousLevel := rep.Level

	newScore := domain.ClampScore(previousScore + params.Delta)
	appliedDelta := newScore - previousScore

	levelInfo := domain.LevelFor(newScore)
	newLevel := levelInfo.Level
	levelChanged := (newLevel != previousLevel)

	// Update counters
	if params.Reason == domain.ReasonLikeReceived && params.Delta > 0 {
		rep.LikesReceived += 1
	} else if params.Reason == domain.ReasonDislikeReceived && params.Delta < 0 {
		rep.DislikesReceived += 1
	} else if params.Reason == domain.ReasonMessageBlocked {
		rep.MessagesBlocked += 1
	} else if params.Reason == domain.ReasonMessageWarned {
		rep.MessagesWarned += 1
	}

	// Insert into reputation_ledger
	ledgerID := uuid.New()
	createdAt := params.OccurredAt
	if createdAt.IsZero() {
		createdAt = time.Now().UTC()
	}

	_, err = tx.Exec(ctx, `
		INSERT INTO reputation_ledger (id, user_id, delta, applied_delta, reason, source_event_id, dedupe_key, score_after, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
	`, ledgerID, params.UserID, params.Delta, appliedDelta, params.Reason, params.SourceEventID, params.DedupeKey, newScore, createdAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrDuplicateEvent
		}
		return nil, fmt.Errorf("failed to insert ledger entry: %w", err)
	}

	// Update user_reputation
	_, err = tx.Exec(ctx, `
		UPDATE user_reputation
		SET score = $1,
		    level = $2,
		    likes_received = $3,
		    dislikes_received = $4,
		    messages_blocked = $5,
		    messages_warned = $6,
		    version = version + 1,
		    updated_at = now()
		WHERE user_id = $7
	`, newScore, newLevel, rep.LikesReceived, rep.DislikesReceived, rep.MessagesBlocked, rep.MessagesWarned, params.UserID)
	if err != nil {
		return nil, fmt.Errorf("failed to update user_reputation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit transaction: %w", err)
	}

	return &domain.AppliedChange{
		UserID:        params.UserID,
		PreviousScore: previousScore,
		Score:         newScore,
		Delta:         params.Delta,
		AppliedDelta:  appliedDelta,
		PreviousLevel: previousLevel,
		Level:         newLevel,
		LevelChanged:  levelChanged,
		Reason:        params.Reason,
		SourceEventID: params.SourceEventID,
		OccurredAt:    createdAt,
		ScoreAfter:    newScore,
	}, nil
}

func (r *PostgresReputationRepository) GetLeaderboard(ctx context.Context, limit int, cursor string) ([]domain.UserReputation, string, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	var rows pgx.Rows
	var err error

	if cursor != "" {
		cursorScore, cursorUserID, errDecode := decodeLeaderboardCursor(cursor)
		if errDecode != nil {
			return nil, "", fmt.Errorf("invalid cursor: %w", errDecode)
		}
		query := `
			SELECT user_id, score, level, likes_received, dislikes_received, messages_blocked, messages_warned, version, updated_at
			FROM user_reputation
			WHERE (score < $1) OR (score = $1 AND user_id < $2)
			ORDER BY score DESC, user_id DESC
			LIMIT $3
		`
		rows, err = r.pool.Query(ctx, query, cursorScore, cursorUserID, limit)
	} else {
		query := `
			SELECT user_id, score, level, likes_received, dislikes_received, messages_blocked, messages_warned, version, updated_at
			FROM user_reputation
			ORDER BY score DESC, user_id DESC
			LIMIT $1
		`
		rows, err = r.pool.Query(ctx, query, limit)
	}

	if err != nil {
		return nil, "", fmt.Errorf("querying leaderboard: %w", err)
	}
	defer rows.Close()

	var result []domain.UserReputation
	for rows.Next() {
		var rep domain.UserReputation
		if err := rows.Scan(
			&rep.UserID,
			&rep.Score,
			&rep.Level,
			&rep.LikesReceived,
			&rep.DislikesReceived,
			&rep.MessagesBlocked,
			&rep.MessagesWarned,
			&rep.Version,
			&rep.UpdatedAt,
		); err != nil {
			return nil, "", fmt.Errorf("scanning leaderboard row: %w", err)
		}
		result = append(result, rep)
	}

	var nextCursor string
	if len(result) == limit {
		last := result[len(result)-1]
		nextCursor = encodeLeaderboardCursor(last.Score, last.UserID)
	}

	return result, nextCursor, nil
}

func (r *PostgresReputationRepository) GetHistory(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReputationLedger, string, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}

	var rows pgx.Rows
	var err error

	if cursor != "" {
		cursorCreatedAt, cursorID, errDecode := decodeHistoryCursor(cursor)
		if errDecode != nil {
			return nil, "", fmt.Errorf("invalid cursor: %w", errDecode)
		}
		query := `
			SELECT id, user_id, delta, applied_delta, reason, source_event_id, dedupe_key, score_after, created_at
			FROM reputation_ledger
			WHERE user_id = $1 AND ((created_at < $2) OR (created_at = $2 AND id < $3))
			ORDER BY created_at DESC, id DESC
			LIMIT $4
		`
		rows, err = r.pool.Query(ctx, query, userID, cursorCreatedAt, cursorID, limit)
	} else {
		query := `
			SELECT id, user_id, delta, applied_delta, reason, source_event_id, dedupe_key, score_after, created_at
			FROM reputation_ledger
			WHERE user_id = $1
			ORDER BY created_at DESC, id DESC
			LIMIT $2
		`
		rows, err = r.pool.Query(ctx, query, userID, limit)
	}

	if err != nil {
		return nil, "", fmt.Errorf("querying history: %w", err)
	}
	defer rows.Close()

	var result []domain.ReputationLedger
	for rows.Next() {
		var entry domain.ReputationLedger
		if err := rows.Scan(
			&entry.ID,
			&entry.UserID,
			&entry.Delta,
			&entry.AppliedDelta,
			&entry.Reason,
			&entry.SourceEventID,
			&entry.DedupeKey,
			&entry.ScoreAfter,
			&entry.CreatedAt,
		); err != nil {
			return nil, "", fmt.Errorf("scanning history row: %w", err)
		}
		result = append(result, entry)
	}

	var nextCursor string
	if len(result) == limit {
		last := result[len(result)-1]
		nextCursor = encodeHistoryCursor(last.CreatedAt, last.ID)
	}

	return result, nextCursor, nil
}

func (r *PostgresReputationRepository) RecomputeUserReputationTx(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("failed to begin recompute tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Ensure user exists
	_, err = tx.Exec(ctx, `
		INSERT INTO user_reputation (user_id, score, level)
		VALUES ($1, 0, 'Novato')
		ON CONFLICT (user_id) DO NOTHING
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to ensure user_reputation row: %w", err)
	}

	// Lock the row
	var version int
	err = tx.QueryRow(ctx, `SELECT version FROM user_reputation WHERE user_id = $1 FOR UPDATE`, userID).Scan(&version)
	if err != nil {
		return nil, fmt.Errorf("failed to lock user_reputation: %w", err)
	}

	// Read all ledger movements in chronological order
	rows, err := tx.Query(ctx, `
		SELECT delta, applied_delta, reason
		FROM reputation_ledger
		WHERE user_id = $1
		ORDER BY created_at ASC, id ASC
	`, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to query ledger for recompute: %w", err)
	}
	defer rows.Close()

	score := 0
	likes := 0
	dislikes := 0
	blocked := 0
	warned := 0

	for rows.Next() {
		var delta, appliedDelta int
		var reason string
		if err := rows.Scan(&delta, &appliedDelta, &reason); err != nil {
			return nil, fmt.Errorf("failed scanning recompute ledger: %w", err)
		}

		score = domain.ClampScore(score + delta)
		if reason == domain.ReasonLikeReceived && delta > 0 {
			likes += 1
		} else if reason == domain.ReasonDislikeReceived && delta < 0 {
			dislikes += 1
		} else if reason == domain.ReasonMessageBlocked {
			blocked += 1
		} else if reason == domain.ReasonMessageWarned {
			warned += 1
		}
	}

	levelInfo := domain.LevelFor(score)

	// Update user_reputation
	var rep domain.UserReputation
	err = tx.QueryRow(ctx, `
		UPDATE user_reputation
		SET score = $1,
		    level = $2,
		    likes_received = $3,
		    dislikes_received = $4,
		    messages_blocked = $5,
		    messages_warned = $6,
		    version = version + 1,
		    updated_at = now()
		WHERE user_id = $7
		RETURNING user_id, score, level, likes_received, dislikes_received, messages_blocked, messages_warned, version, updated_at
	`, score, levelInfo.Level, likes, dislikes, blocked, warned, userID).Scan(
		&rep.UserID,
		&rep.Score,
		&rep.Level,
		&rep.LikesReceived,
		&rep.DislikesReceived,
		&rep.MessagesBlocked,
		&rep.MessagesWarned,
		&rep.Version,
		&rep.UpdatedAt,
	)
	if err != nil {
		return nil, fmt.Errorf("failed to update recomputed reputation: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("failed to commit recompute tx: %w", err)
	}

	return &rep, nil
}

// Cursor helpers

func encodeLeaderboardCursor(score int, userID uuid.UUID) string {
	raw := fmt.Sprintf("%d:%s", score, userID.String())
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func decodeLeaderboardCursor(cursor string) (int, uuid.UUID, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return 0, uuid.Nil, err
	}
	parts := strings.Split(string(data), ":")
	if len(parts) != 2 {
		return 0, uuid.Nil, fmt.Errorf("invalid cursor format")
	}
	score, err := strconv.Atoi(parts[0])
	if err != nil {
		return 0, uuid.Nil, err
	}
	userID, err := uuid.Parse(parts[1])
	if err != nil {
		return 0, uuid.Nil, err
	}
	return score, userID, nil
}

func encodeHistoryCursor(createdAt time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%s:%s", createdAt.Format(time.RFC3339Nano), id.String())
	return base64.URLEncoding.EncodeToString([]byte(raw))
}

func decodeHistoryCursor(cursor string) (time.Time, uuid.UUID, error) {
	data, err := base64.URLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	parts := strings.Split(string(data), ":")
	if len(parts) < 2 {
		return time.Time{}, uuid.Nil, fmt.Errorf("invalid cursor format")
	}
	createdAtStr := strings.Join(parts[:len(parts)-1], ":")
	idStr := parts[len(parts)-1]

	createdAt, err := time.Parse(time.RFC3339Nano, createdAtStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	id, err := uuid.Parse(idStr)
	if err != nil {
		return time.Time{}, uuid.Nil, err
	}
	return createdAt, id, nil
}
