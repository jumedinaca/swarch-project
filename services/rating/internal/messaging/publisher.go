package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"rating/internal/domain"
	"rating/internal/schema"
)

type RatingEventPublisher struct {
	broker *Broker
}

func NewRatingEventPublisher(b *Broker) *RatingEventPublisher {
	return &RatingEventPublisher{broker: b}
}

// BuildRatingChangedEvent arma el evento rating.changed.v1 a partir del cambio
// de voto. Si no llega correlationID se usa el propio eventId.
func BuildRatingChangedEvent(change *domain.VoteChange, correlationID string) schema.RatingChangedEvent {
	eventID := uuid.Must(uuid.NewV7())
	if correlationID == "" {
		correlationID = eventID.String()
	}
	changedAt := change.ChangedAt.UTC()
	if changedAt.IsZero() {
		changedAt = time.Now().UTC()
	}
	return schema.RatingChangedEvent{
		EventID:       eventID,
		EventType:     schema.EventRatingChanged,
		Version:       1,
		OccurredAt:    changedAt,
		Producer:      schema.Producer,
		CorrelationID: correlationID,
		CausationID:   nil, // el cambio lo origina una peticion HTTP, no otro evento
		Payload: schema.RatingChangedPayload{
			RatingID:        change.RatingID,
			MessageID:       change.MessageID,
			MessageAuthorID: change.AuthorID,
			RaterID:         change.RaterID,
			PreviousValue:   int(change.Previous),
			Value:           int(change.Value),
			Likes:           change.Likes,
			Dislikes:        change.Dislikes,
			ChangedAt:       changedAt,
		},
	}
}

func (p *RatingEventPublisher) PublishRatingChanged(ctx context.Context, change *domain.VoteChange, correlationID string) error {
	event := BuildRatingChangedEvent(change, correlationID)
	body, err := json.Marshal(event)
	if err != nil {
		return fmt.Errorf("marshal %s: %w", schema.EventRatingChanged, err)
	}

	err = p.broker.Publish(ctx, schema.EventRatingChanged, amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  "application/json",
		MessageId:    event.EventID.String(),
		Type:         schema.EventRatingChanged,
		Timestamp:    event.OccurredAt,
		Headers: amqp.Table{
			"x-event-id":       event.EventID.String(),
			"x-event-type":     schema.EventRatingChanged,
			"x-correlation-id": event.CorrelationID,
		},
		Body: body,
	})
	if err != nil {
		return err
	}

	slog.Info("Published rating.changed.v1",
		"eventId", event.EventID,
		"messageId", change.MessageID,
		"previousValue", int(change.Previous),
		"value", int(change.Value),
	)
	return nil
}
