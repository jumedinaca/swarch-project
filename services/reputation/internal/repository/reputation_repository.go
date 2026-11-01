package repository

import (
	"context"
	"errors"
	"time"

	"github.com/google/uuid"

	"reputation/internal/domain"
)

var (
	ErrDuplicateEvent = errors.New("duplicate event: already processed")
	ErrUserNotFound   = errors.New("user not found")
)

type ApplyChangeParams struct {
	UserID        uuid.UUID
	Delta         int
	Reason        string
	SourceEventID uuid.UUID
	DedupeKey     string
	OccurredAt    time.Time
}

type ReputationRepository interface {
	GetUserReputation(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error)
	GetLeaderboard(ctx context.Context, limit int, cursor string) ([]domain.UserReputation, string, error)
	GetHistory(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReputationLedger, string, error)
	HasLedgerDedupeKey(ctx context.Context, userID uuid.UUID, dedupeKey string) (bool, error)
	ApplyReputationChangeTx(ctx context.Context, params ApplyChangeParams) (*domain.AppliedChange, error)
	RecomputeUserReputationTx(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error)
}
