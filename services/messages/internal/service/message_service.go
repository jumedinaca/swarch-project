package service

import (
	"context"
	"fmt"
	"github.com/google/uuid"
	"messages/internal/domain"
	"messages/internal/repository"
)

type MessageService struct {
	repository repository.MessageRepository
}

func NewMessageService(
	repository repository.MessageRepository,
) *MessageService {
	return &MessageService{
		repository: repository,
	}
}

func (s *MessageService) CreateMessage(
	ctx context.Context,
	message *domain.Message,
) (*domain.Message, error) {

	if message.Content == "" {
		return nil, fmt.Errorf("content cannot be empty")
	}

	return s.repository.Create(ctx, message)
}

func (s *MessageService) DeleteMessage(
    ctx context.Context,
    messageID uuid.UUID,
    userID uuid.UUID,
) error {

    return s.repository.Delete(
        ctx,
        messageID,
        userID,
    )
}

func (s *MessageService) GetMessageById(
    ctx context.Context,
    messageID uuid.UUID,
    userID uuid.UUID,
) (*domain.Message, error) {

    return s.repository.GetByID(
        ctx,
        messageID,
        userID,
    )
}

func (s *MessageService) GetNearby(
	ctx context.Context,
	latitude float64,
	longitude float64,
	radius float64,
) ([]*domain.Message, error) {

	if latitude < -90 || latitude > 90 {
		return nil, fmt.Errorf("invalid latitude")
	}

	if longitude < -180 || longitude > 180 {
		return nil, fmt.Errorf("invalid longitude")
	}

	if radius <= 0 {
		return nil, fmt.Errorf("radius must be greater than zero")
	}

	return s.repository.GetNearby(
		ctx,
		latitude,
		longitude,
		radius,
	)
}