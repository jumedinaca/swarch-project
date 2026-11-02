package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"messages/internal/domain"
	"messages/internal/schema"
)

const contentPreviewLimit = 140

type RabbitMQPublisher struct {
	connection *RabbitMQConnection
}

func NewRabbitMQPublisher(conn *RabbitMQConnection) *RabbitMQPublisher {
	return &RabbitMQPublisher{connection: conn}
}

func (p *RabbitMQPublisher) PublishMessageSubmitted(
	ctx context.Context,
	message *domain.Message,
	correlationID uuid.UUID,
) error {
	if correlationID == uuid.Nil {
		correlationID = uuid.New()
	}

	event := schema.MessageSubmittedEvent{
		EventId:       uuid.New(),
		EventType:     "message.submitted.v1",
		Version:       1,
		OccurredAt:    time.Now().UTC(),
		Producer:      "messages",
		CorrelationId: correlationID,
		Payload: schema.MessageSubmittedPayload{
			MessageId:      message.ID,
			AuthorId:       message.SenderID,
			Content:        message.Content,
			Latitude:       message.Location.Latitude,
			Longitude:      message.Location.Longitude,
			MessageVersion: message.Version,
			CreatedAt:      message.CreatedAt,
		},
	}

	return p.publish(ctx, event.EventType, event)
}

func (p *RabbitMQPublisher) PublishMessagePublished(
	ctx context.Context,
	message *domain.Message,
	moderationDecision string,
	correlationID uuid.UUID,
) error {
	if correlationID == uuid.Nil {
		correlationID = uuid.New()
	}

	event := schema.MessagePublishedEvent{
		EventId:       uuid.New(),
		EventType:     "message.published.v1",
		Version:       1,
		OccurredAt:    time.Now().UTC(),
		Producer:      "messages",
		CorrelationId: correlationID,
		Payload: schema.MessagePublishedPayload{
			MessageId:          message.ID,
			AuthorId:           message.SenderID,
			ContentPreview:     truncateRunes(message.Content, contentPreviewLimit),
			Latitude:           message.Location.Latitude,
			Longitude:          message.Location.Longitude,
			ModerationDecision: moderationDecision,
			PublishedAt:        time.Now().UTC(),
		},
	}

	return p.publish(ctx, event.EventType, event)
}

func (p *RabbitMQPublisher) PublishMessageDeleted(
	ctx context.Context,
	message *domain.Message,
	correlationID uuid.UUID,
) error {
	if correlationID == uuid.Nil {
		correlationID = uuid.New()
	}

	event := schema.MessageDeletedEvent{
		EventId:       uuid.New(),
		EventType:     "message.deleted.v1",
		Version:       1,
		OccurredAt:    time.Now().UTC(),
		Producer:      "messages",
		CorrelationId: correlationID,
		Payload: schema.MessageDeletedPayload{
			MessageId:      message.ID,
			AuthorId:       message.SenderID,
			MessageVersion: message.Version,
			DeletedAt:      time.Now().UTC(),
		},
	}

	return p.publish(ctx, event.EventType, event)
}

func (p *RabbitMQPublisher) publish(ctx context.Context, routingKey string, event any) error {
	if err := p.connection.EnsureConnected(); err != nil {
		return fmt.Errorf("rabbitmq unavailable: %w", err)
	}

	ch := p.connection.Channel()
	if ch == nil {
		return fmt.Errorf("rabbitmq channel not available")
	}

	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal %s: %w", routingKey, err)
	}

	msg := amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  "application/json",
		Type:         routingKey,
		Timestamp:    time.Now().UTC(),
		Body:         body,
	}

	if err := ch.PublishWithContext(
		ctx,
		p.connection.ExchangeName(),
		routingKey,
		false,
		false,
		msg,
	); err != nil {
		return fmt.Errorf("failed to publish %s: %w", routingKey, err)
	}

	slog.Debug("Event published", "eventType", routingKey)
	return nil
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}
