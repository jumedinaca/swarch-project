package service

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"reputation/internal/domain"
	"reputation/internal/messaging"
	"reputation/internal/repository"
	"reputation/internal/schema"
)

type ReputationService struct {
	repo      repository.ReputationRepository
	publisher messaging.EventPublisher
}

func NewReputationService(repo repository.ReputationRepository, pub messaging.EventPublisher) *ReputationService {
	return &ReputationService{
		repo:      repo,
		publisher: pub,
	}
}

// HandleRatingChanged processes rating.changed.v1 events.
func (s *ReputationService) HandleRatingChanged(ctx context.Context, event *schema.RatingChangedEvent) error {
	p := event.Payload

	// Ignore if rater is the author of the message
	if p.RaterId == p.MessageAuthorId {
		slog.Info("Ignoring self-rating event", "messageId", p.MessageId, "authorId", p.MessageAuthorId)
		return nil
	}

	delta := (p.Value - p.PreviousValue) * 2
	if delta == 0 {
		slog.Debug("Delta is 0 for rating change, skipping", "eventId", event.EventId)
		return nil
	}

	var reason string
	if p.Value == 1 {
		reason = domain.ReasonLikeReceived
	} else if p.Value == -1 {
		reason = domain.ReasonDislikeReceived
	} else {
		// Value is 0 (vote removed)
		if p.PreviousValue == 1 {
			reason = domain.ReasonDislikeReceived
		} else {
			reason = domain.ReasonLikeReceived
		}
	}

	dedupeKey := fmt.Sprintf("rating:%s:%s:%d", p.MessageId.String(), p.RaterId.String(), p.Value)

	occurredAt := event.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}

	applied, err := s.repo.ApplyReputationChangeTx(ctx, repository.ApplyChangeParams{
		UserID:        p.MessageAuthorId,
		Delta:         delta,
		Reason:        reason,
		SourceEventID: event.EventId,
		DedupeKey:     dedupeKey,
		OccurredAt:    occurredAt,
	})

	if err != nil {
		if errors.Is(err, repository.ErrDuplicateEvent) {
			slog.Info("Rating event already processed (idempotent ignore)", "eventId", event.EventId)
			return nil
		}
		return fmt.Errorf("error applying rating reputation change: %w", err)
	}

	// Publish reputation.changed.v1 post-commit (if RabbitMQ fails, log and continue in P2)
	if s.publisher != nil {
		if pubErr := s.publisher.PublishReputationChanged(ctx, applied, event.CorrelationId); pubErr != nil {
			slog.Warn("Failed to publish reputation.changed.v1 after rating commit", "error", pubErr)
		}
	}

	return nil
}

// HandleModerationCompleted processes moderation.completed.v1 events.
func (s *ReputationService) HandleModerationCompleted(ctx context.Context, event *schema.ModerationCompletedEvent) error {
	p := event.Payload

	var delta int
	var reason string
	var dedupeKey string

	switch p.Decision {
	case "ALLOW":
		delta = 1
		reason = domain.ReasonMessageAllowed
		dedupeKey = fmt.Sprintf("moderation:allow:%s", p.MessageId.String())

	case "WARN":
		delta = -3
		reason = domain.ReasonMessageWarned
		dedupeKey = fmt.Sprintf("moderation:warn:%s", p.MessageId.String())

	case "BLOCK":
		dedupeKey = fmt.Sprintf("moderation:block:%s", p.MessageId.String())
		reason = domain.ReasonMessageBlocked

		// Rule: If message was previously warned, apply difference (-10 - (-3) = -7)
		hasWarn, err := s.repo.HasLedgerDedupeKey(ctx, p.AuthorId, fmt.Sprintf("moderation:warn:%s", p.MessageId.String()))
		if err != nil {
			slog.Warn("Failed checking previous warn in ledger, applying full block delta", "error", err)
			delta = -10
		} else if hasWarn {
			delta = -7
			slog.Info("Message transitioned from WARN to BLOCK: applying delta -7", "messageId", p.MessageId)
		} else {
			delta = -10
		}

	case "REVIEW", "DEGRADED":
		slog.Debug("Moderation decision has delta 0, skipping", "decision", p.Decision, "messageId", p.MessageId)
		return nil

	default:
		slog.Warn("Unknown moderation decision, skipping", "decision", p.Decision)
		return nil
	}

	occurredAt := event.OccurredAt
	if occurredAt.IsZero() {
		occurredAt = time.Now().UTC()
	}

	applied, err := s.repo.ApplyReputationChangeTx(ctx, repository.ApplyChangeParams{
		UserID:        p.AuthorId,
		Delta:         delta,
		Reason:        reason,
		SourceEventID: event.EventId,
		DedupeKey:     dedupeKey,
		OccurredAt:    occurredAt,
	})

	if err != nil {
		if errors.Is(err, repository.ErrDuplicateEvent) {
			slog.Info("Moderation event already processed (idempotent ignore)", "eventId", event.EventId)
			return nil
		}
		return fmt.Errorf("error applying moderation reputation change: %w", err)
	}

	// Publish reputation.changed.v1 post-commit
	if s.publisher != nil {
		if pubErr := s.publisher.PublishReputationChanged(ctx, applied, event.CorrelationId); pubErr != nil {
			slog.Warn("Failed to publish reputation.changed.v1 after moderation commit", "error", pubErr)
		}
	}

	return nil
}

// GetUserReputation fetches user reputation, returning score 0 and Novato if no row exists yet.
func (s *ReputationService) GetUserReputation(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	rep, err := s.repo.GetUserReputation(ctx, userID)
	if err != nil {
		return nil, err
	}
	if rep == nil {
		levelInfo := domain.LevelFor(0)
		return &domain.UserReputation{
			UserID:           userID,
			Score:            0,
			Level:            levelInfo.Level,
			LikesReceived:    0,
			DislikesReceived: 0,
			MessagesBlocked:  0,
			MessagesWarned:   0,
			Version:          0,
			UpdatedAt:        time.Now().UTC(),
		}, nil
	}
	return rep, nil
}

// GetLeaderboard returns the leaderboard with optional cursor pagination.
func (s *ReputationService) GetLeaderboard(ctx context.Context, limit int, cursor string) ([]domain.UserReputation, string, error) {
	return s.repo.GetLeaderboard(ctx, limit, cursor)
}

// GetHistory returns user reputation ledger history with optional cursor pagination.
func (s *ReputationService) GetHistory(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReputationLedger, string, error) {
	return s.repo.GetHistory(ctx, userID, limit, cursor)
}

// Recompute recalculates score and level from ledger movements.
func (s *ReputationService) Recompute(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	return s.repo.RecomputeUserReputationTx(ctx, userID)
}
