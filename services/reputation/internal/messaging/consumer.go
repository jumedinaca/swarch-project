package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"reputation/internal/schema"
)

type ReputationEventHandler interface {
	HandleRatingChanged(ctx context.Context, event *schema.RatingChangedEvent) error
	HandleModerationCompleted(ctx context.Context, event *schema.ModerationCompletedEvent) error
}

type RabbitMQConsumer struct {
	connection *RabbitMQConnection
	handler    ReputationEventHandler
}

func NewRabbitMQConsumer(conn *RabbitMQConnection, handler ReputationEventHandler) *RabbitMQConsumer {
	return &RabbitMQConsumer{
		connection: conn,
		handler:    handler,
	}
}

// Start begins consuming events in background goroutines.
func (c *RabbitMQConsumer) Start(ctx context.Context) error {
	ch := c.connection.Channel()
	if ch == nil {
		return fmt.Errorf("rabbitmq channel is nil")
	}

	// 1. Queue for rating events
	ratingQueueName := "reputation.rating.changed.q"
	_, err := ch.QueueDeclare(
		ratingQueueName,
		true,  // durable
		false, // delete when unused
		false, // exclusive
		false, // no-wait
		nil,   // arguments
	)
	if err != nil {
		return fmt.Errorf("failed declaring queue %s: %w", ratingQueueName, err)
	}

	err = ch.QueueBind(
		ratingQueueName,
		"rating.changed.v1",
		c.connection.ExchangeName(),
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed binding queue %s: %w", ratingQueueName, err)
	}

	// 2. Queue for moderation events
	moderationQueueName := "reputation.moderation.completed.q"
	_, err = ch.QueueDeclare(
		moderationQueueName,
		true,  // durable
		false, // delete when unused
		false, // exclusive
		false, // no-wait
		nil,   // arguments
	)
	if err != nil {
		return fmt.Errorf("failed declaring queue %s: %w", moderationQueueName, err)
	}

	err = ch.QueueBind(
		moderationQueueName,
		"moderation.completed.v1",
		c.connection.ExchangeName(),
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed binding queue %s: %w", moderationQueueName, err)
	}

	// Set prefetch count
	if err := ch.Qos(20, 0, false); err != nil {
		return fmt.Errorf("failed to set Qos: %w", err)
	}

	// Start consuming rating queue
	ratingDeliveries, err := ch.Consume(
		ratingQueueName,
		"reputation-rating-consumer",
		false, // manual ack
		false, // exclusive
		false, // no-local
		false, // no-wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed consuming from %s: %w", ratingQueueName, err)
	}

	// Start consuming moderation queue
	moderationDeliveries, err := ch.Consume(
		moderationQueueName,
		"reputation-moderation-consumer",
		false, // manual ack
		false, // exclusive
		false, // no-local
		false, // no-wait
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed consuming from %s: %w", moderationQueueName, err)
	}

	slog.Info("RabbitMQ consumers initialized and listening on queues",
		"ratingQueue", ratingQueueName,
		"moderationQueue", moderationQueueName,
	)

	go c.processRatingMessages(ctx, ratingDeliveries)
	go c.processModerationMessages(ctx, moderationDeliveries)

	return nil
}

func (c *RabbitMQConsumer) processRatingMessages(ctx context.Context, deliveries <-chan amqp.Delivery) {
	for {
		select {
		case <-ctx.Done():
			slog.Info("Rating messages consumer stopping...")
			return
		case d, ok := <-deliveries:
			if !ok {
				slog.Warn("Rating messages deliveries channel closed")
				return
			}
			c.handleRatingDelivery(ctx, d)
		}
	}
}

func (c *RabbitMQConsumer) handleRatingDelivery(ctx context.Context, d amqp.Delivery) {
	var event schema.RatingChangedEvent
	if err := json.Unmarshal(d.Body, &event); err != nil {
		slog.Error("Failed to unmarshal rating.changed.v1 event, discarding message", "error", err)
		_ = d.Ack(false)
		return
	}

	msgCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	err := c.handler.HandleRatingChanged(msgCtx, &event)
	if err != nil {
		slog.Error("Failed processing rating.changed.v1 event, requeuing", "error", err, "eventId", event.EventId)
		_ = d.Nack(false, true)
		return
	}

	_ = d.Ack(false)
}

func (c *RabbitMQConsumer) processModerationMessages(ctx context.Context, deliveries <-chan amqp.Delivery) {
	for {
		select {
		case <-ctx.Done():
			slog.Info("Moderation messages consumer stopping...")
			return
		case d, ok := <-deliveries:
			if !ok {
				slog.Warn("Moderation messages deliveries channel closed")
				return
			}
			c.handleModerationDelivery(ctx, d)
		}
	}
}

func (c *RabbitMQConsumer) handleModerationDelivery(ctx context.Context, d amqp.Delivery) {
	var event schema.ModerationCompletedEvent
	if err := json.Unmarshal(d.Body, &event); err != nil {
		slog.Error("Failed to unmarshal moderation.completed.v1 event, discarding message", "error", err)
		_ = d.Ack(false)
		return
	}

	msgCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	err := c.handler.HandleModerationCompleted(msgCtx, &event)
	if err != nil {
		slog.Error("Failed processing moderation.completed.v1 event, requeuing", "error", err, "eventId", event.EventId)
		_ = d.Nack(false, true)
		return
	}

	_ = d.Ack(false)
}
