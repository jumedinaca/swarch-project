package service

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"

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

func publishEventToRabbit(routingKey string, envelope map[string]any) {
	rabbitURL := os.Getenv("RABBITMQ_HTTP_PUBLISH_URL")
	if rabbitURL == "" {
		rabbitURL = "http://rabbitmq:15672/api/exchanges/geopicto/geopicto.events/publish"
	}

	payloadBytes, err := json.Marshal(envelope)
	if err != nil {
		return
	}

	bodyMap := map[string]any{
		"properties":       map[string]any{},
		"routing_key":      routingKey,
		"payload":          string(payloadBytes),
		"payload_encoding": "string",
	}
	bodyBytes, err := json.Marshal(bodyMap)
	if err != nil {
		return
	}

	client := &http.Client{Timeout: 2 * time.Second}
	req, err := http.NewRequest(http.MethodPost, rabbitURL, bytes.NewReader(bodyBytes))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth("geopicto", "geopicto")

	resp, err := client.Do(req)
	if err == nil && resp != nil {
		resp.Body.Close()
	}
}

func (s *MessageService) CreateMessage(
	ctx context.Context,
	message *domain.Message,
) (*domain.Message, error) {

	if message.Content == "" {
		return nil, fmt.Errorf("content cannot be empty")
	}

	created, err := s.repository.Create(ctx, message)
	if err != nil {
		return nil, err
	}

	evtID := uuid.NewString()
	nowISO := time.Now().UTC().Format(time.RFC3339)
	pubISO := created.CreatedAt.UTC().Format(time.RFC3339)
	if created.CreatedAt.IsZero() {
		pubISO = nowISO
	}

	go publishEventToRabbit("message.published.v1", map[string]any{
		"eventId":       evtID,
		"event":         "message.published.v1",
		"eventType":     "message.published.v1",
		"version":       1,
		"occurredAt":    nowISO,
		"producer":      "messages",
		"correlationId": evtID,
		"payload": map[string]any{
			"messageId":          created.ID.String(),
			"authorId":           created.SenderID.String(),
			"contentPreview":     created.Content,
			"latitude":           created.Location.Latitude,
			"longitude":          created.Location.Longitude,
			"moderationDecision": "ALLOW",
			"publishedAt":        pubISO,
		},
	})

	return created, nil
}

func (s *MessageService) DeleteMessage(
	ctx context.Context,
	messageID uuid.UUID,
	userID uuid.UUID,
) error {

	err := s.repository.Delete(
		ctx,
		messageID,
		userID,
	)
	if err != nil {
		return err
	}

	evtID := uuid.NewString()
	nowISO := time.Now().UTC().Format(time.RFC3339)

	go publishEventToRabbit("message.deleted.v1", map[string]any{
		"eventId":       evtID,
		"event":         "message.deleted.v1",
		"eventType":     "message.deleted.v1",
		"version":       1,
		"occurredAt":    nowISO,
		"producer":      "messages",
		"correlationId": evtID,
		"payload": map[string]any{
			"messageId": messageID.String(),
			"authorId":  userID.String(),
			"deletedAt": nowISO,
		},
	})

	return nil
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