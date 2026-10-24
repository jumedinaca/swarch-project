package repository

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"messages/internal/domain"
	"messages/internal/repository/sqlc"
)

type MessageRepository interface {
	Create(ctx context.Context, message *domain.Message) (*domain.Message, error)
	Update(ctx context.Context, id uuid.UUID, message *domain.Message) (*domain.Message, error)
	Delete(ctx context.Context, id uuid.UUID) error
	GetByID(ctx context.Context, id uuid.UUID) (*domain.Message, error)
	GetNearby(ctx context.Context, latitude float64, longitude float64, radius float64) ([]*domain.Message, error)
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
		row.CreatedAt,
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
		row.CreatedAt,
	), nil
}

func (r *postgresMessageRepository) Delete(
	ctx context.Context,
	id uuid.UUID,
) error {

	rowsAffected, err := r.queries.DeleteMessage(ctx, id)
	if err != nil {
		return fmt.Errorf("error deleting message: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("message not found")
	}

	return nil
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
		row.CreatedAt,
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
			row.CreatedAt,
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
	createdAt time.Time,
) *domain.Message {
	return &domain.Message{
		ID:       id,
		SenderID: senderID,
		Content:  content,
		Location: domain.Location{
			Latitude:  latitude,
			Longitude: longitude,
		},
		CreatedAt: createdAt,
	}
}
