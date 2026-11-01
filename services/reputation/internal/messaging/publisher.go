package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"reputation/internal/domain"
	"reputation/internal/schema"
)

type EventPublisher interface {
	PublishReputationChanged(ctx context.Context, change *domain.AppliedChange, correlationID uuid.UUID) error
}

type RabbitMQPublisher struct {
	connection *RabbitMQConnection
}

func NewRabbitMQPublisher(conn *RabbitMQConnection) *RabbitMQPublisher {
	return &RabbitMQPublisher{connection: conn}
}

func (p *RabbitMQPublisher) PublishReputationChanged(ctx context.Context, change *domain.AppliedChange, correlationID uuid.UUID) error {
	ch := p.connection.Channel()
	if ch == nil || !p.connection.IsHealthy() {
		slog.Warn("Cannot publish reputation.changed.v1: RabbitMQ channel not available")
		return fmt.Errorf("rabbitmq channel not available")
	}

	eventID := uuid.New()
	occurredAt := time.Now().UTC().Format(time.RFC3339)
	if !change.OccurredAt.IsZero() {
		occurredAt = change.OccurredAt.UTC().Format(time.RFC3339)
	}

	if correlationID == uuid.Nil {
		correlationID = eventID
	}
	causationID := change.SourceEventID

	event := schema.ReputationChangedEvent{
		EventId:       eventID,
		EventType:     "reputation.changed.v1",
		Version:       1,
		OccurredAt:    occurredAt,
		Producer:      "reputation",
		CorrelationId: correlationID,
		CausationId:   &causationID,
		Payload: schema.ReputationChangedPayload{
			UserId:        change.UserID,
			PreviousScore: change.PreviousScore,
			Score:         change.Score,
			Delta:         change.Delta,
			PreviousLevel: change.PreviousLevel,
			Level:         change.Level,
			LevelChanged:  change.LevelChanged,
			Reason:        change.Reason,
			SourceEventId: change.SourceEventID,
			OccurredAt:    occurredAt,
		},
	}

	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("failed to marshal reputation.changed.v1 event: %w", err)
	}

	msg := amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  "application/json",
		MessageId:    eventID.String(),
		Type:         "reputation.changed.v1",
		Timestamp:    time.Now().UTC(),
		Headers: amqp.Table{
			"x-event-id":        eventID.String(),
			"x-event-type":      "reputation.changed.v1",
			"x-correlation-id":  correlationID.String(),
		},
		Body: body,
	}

	err = ch.PublishWithContext(
		ctx,
		p.connection.ExchangeName(),
		"reputation.changed.v1",
		false,
		false,
		msg,
	)
	if err != nil {
		slog.Error("Failed to publish reputation.changed.v1", "error", err, "eventId", eventID)
		return fmt.Errorf("failed to publish to exchange: %w", err)
	}

	slog.Info("Published reputation.changed.v1",
		"userId", change.UserID,
		"score", change.Score,
		"level", change.Level,
		"reason", change.Reason,
		"eventId", eventID,
	)
	return nil
}
