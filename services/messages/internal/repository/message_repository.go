package repository

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"messages/internal/domain"
	"messages/internal/repository/sqlc"
)

type MessageRepository interface {
	Create(ctx context.Context, message *domain.Message) (*domain.Message, error)
	Update(ctx context.Context, id uuid.UUID, message *domain.Message) (*domain.Message, error)
	Delete(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	GetNearby(ctx context.Context, latitude float64, longitude float64, radius float64) ([]*domain.Message, error)
	ApplyModerationDecision(
		ctx context.Context,
		id uuid.UUID,
		version int32,
		status domain.MessageStatus,
		moderationStatus domain.ModerationStatus,
		moderationReason string,
	) (*domain.Message, error)
	ListStalePending(ctx context.Context, cutoff time.Time) ([]*domain.Message, error)
}

type postgresMessageRepository struct {
	queries *sqlc.Queries
}

func NewPostgresMessageRepository(db *pgxpool.Pool) MessageRepository {
	return &postgresMessageRepository{
		queries: sqlc.New(db),
	}
}

func (r *postgresMessageRepository) Create(
	ctx context.Context,
	message *domain.Message,
) (*domain.Message, error) {

	row, err := r.queries.CreateMessage(ctx, sqlc.CreateMessageParams{
		SenderID:  message.SenderID,
		Content:   message.Content,
		Longitude: message.Location.Longitude,
		Latitude:  message.Location.Latitude,
	})
	if err != nil {
		return nil, fmt.Errorf("error creating message: %w", err)
	}

	return toDomainMessage(
		row.ID,
		row.SenderID,
		row.Content,
		row.Latitude,
		row.Longitude,
		row.Status,
		row.ModerationStatus,
		row.ModerationReason,
		row.Version,
		row.CreatedAt,
		row.UpdatedAt,
	), nil
}

func (r *postgresMessageRepository) Update(
	ctx context.Context,
	id uuid.UUID,
	message *domain.Message,
) (*domain.Message, error) {

	row, err := r.queries.UpdateMessage(ctx, sqlc.UpdateMessageParams{
		ID:        id,
		Content:   message.Content,
		Longitude: message.Location.Longitude,
		Latitude:  message.Location.Latitude,
	})
	if err != nil {
		return nil, fmt.Errorf("error updating message: %w", err)
	}

	return toDomainMessage(
		row.ID,
		row.SenderID,
		row.Content,
		row.Latitude,
		row.Longitude,
		row.Status,
		row.ModerationStatus,
		row.ModerationReason,
		row.Version,
		row.CreatedAt,
		row.UpdatedAt,
	), nil
}

func (r *postgresMessageRepository) Delete(
	ctx context.Context,
	id uuid.UUID,
) (*domain.Message, error) {

	row, err := r.queries.DeleteMessage(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("message not found")
		}
		return nil, fmt.Errorf("error deleting message: %w", err)
	}

	return toDomainMessage(
		row.ID,
		row.SenderID,
		row.Content,
		row.Latitude,
		row.Longitude,
		row.Status,
		row.ModerationStatus,
		row.ModerationReason,
		row.Version,
		row.CreatedAt,
		row.UpdatedAt,
	), nil
}

func (r *postgresMessageRepository) GetByID(
	ctx context.Context,
	id uuid.UUID,
) (*domain.Message, error) {

	row, err := r.queries.GetMessageByID(ctx, id)
	if err != nil {
		return nil, fmt.Errorf("error getting message: %w", err)
	}

	return toDomainMessage(
		row.ID,
		row.SenderID,
		row.Content,
		row.Latitude,
		row.Longitude,
		row.Status,
		row.ModerationStatus,
		row.ModerationReason,
		row.Version,
		row.CreatedAt,
		row.UpdatedAt,
	), nil
}

func (r *postgresMessageRepository) GetNearby(
	ctx context.Context,
	latitude float64,
	longitude float64,
	radius float64,
) ([]*domain.Message, error) {

	rows, err := r.queries.GetNearbyMessages(ctx, sqlc.GetNearbyMessagesParams{
		Latitude:  latitude,
		Longitude: longitude,
		Radius:    radius,
	})
	if err != nil {
		return nil, fmt.Errorf("error getting nearby messages: %w", err)
	}

	messages := make([]*domain.Message, 0, len(rows))

	for _, row := range rows {
		messages = append(messages, toDomainMessage(
			row.ID,
			row.SenderID,
			row.Content,
			row.Latitude,
			row.Longitude,
			row.Status,
			row.ModerationStatus,
			row.ModerationReason,
			row.Version,
			row.CreatedAt,
			row.UpdatedAt,
		))
	}

	return messages, nil
}

func (r *postgresMessageRepository) ApplyModerationDecision(
	ctx context.Context,
	id uuid.UUID,
	version int32,
	status domain.MessageStatus,
	moderationStatus domain.ModerationStatus,
	moderationReason string,
) (*domain.Message, error) {

	row, err := r.queries.ApplyModerationDecision(ctx, sqlc.ApplyModerationDecisionParams{
		ID:               id,
		Version:          version,
		Status:           string(status),
		ModerationStatus: string(moderationStatus),
		ModerationReason: moderationReason,
	})
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// La versión no coincide o el mensaje ya no está PENDING:
			// la decisión es vieja o duplicada y se ignora.
			return nil, nil
		}
		return nil, fmt.Errorf("error applying moderation decision: %w", err)
	}

	return toDomainMessage(
		row.ID,
		row.SenderID,
		row.Content,
		row.Latitude,
		row.Longitude,
		row.Status,
		row.ModerationStatus,
		row.ModerationReason,
		row.Version,
		row.CreatedAt,
		row.UpdatedAt,
	), nil
}

func (r *postgresMessageRepository) ListStalePending(
	ctx context.Context,
	cutoff time.Time,
) ([]*domain.Message, error) {

	rows, err := r.queries.ListStalePendingMessages(ctx, cutoff)
	if err != nil {
		return nil, fmt.Errorf("error listing stale pending messages: %w", err)
	}

	messages := make([]*domain.Message, 0, len(rows))
	for _, row := range rows {
		messages = append(messages, toDomainMessage(
			row.ID,
			row.SenderID,
			row.Content,
			row.Latitude,
			row.Longitude,
			row.Status,
			row.ModerationStatus,
			row.ModerationReason,
			row.Version,
			row.CreatedAt,
			row.UpdatedAt,
		))
	}

	return messages, nil
}

func toDomainMessage(
	id uuid.UUID,
	senderID uuid.UUID,
	content string,
	latitude float64,
	longitude float64,
	status string,
	moderationStatus string,
	moderationReason string,
	version int32,
	createdAt time.Time,
	updatedAt time.Time,
) *domain.Message {
	message := &domain.Message{
		ID:       id,
		SenderID: senderID,
		Content:  content,
		Location: domain.Location{
			Latitude:  latitude,
			Longitude: longitude,
		},
		Status:    domain.MessageStatus(status),
		Version:   version,
		CreatedAt: createdAt,
		UpdatedAt: updatedAt,
	}

	if moderationStatus != "" {
		value := domain.ModerationStatus(moderationStatus)
		message.ModerationStatus = &value
	}
	if moderationReason != "" {
		value := moderationReason
		message.ModerationReason = &value
	}

	return message
}
