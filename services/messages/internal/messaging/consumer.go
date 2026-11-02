package messaging

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"

	"messages/internal/schema"
)

type ModerationEventHandler interface {
	HandleModerationCompleted(ctx context.Context, event *schema.ModerationCompletedEvent) error
	HandleModerationFailed(ctx context.Context, event *schema.ModerationFailedEvent) error
}

type RabbitMQConsumer struct {
	connection *RabbitMQConnection
	handler    ModerationEventHandler
}

func NewRabbitMQConsumer(conn *RabbitMQConnection, handler ModerationEventHandler) *RabbitMQConsumer {
	return &RabbitMQConsumer{
		connection: conn,
		handler:    handler,
	}
}

// Start declara las colas de moderación y comienza a consumir en segundo plano.
func (c *RabbitMQConsumer) Start(ctx context.Context) error {
	if err := c.connection.EnsureConnected(); err != nil {
		return err
	}

	ch := c.connection.Channel()
	if ch == nil {
		return fmt.Errorf("rabbitmq channel is nil")
	}

	completedQueue := "messages.moderation.completed.q"
	if err := c.declareAndBind(ch, completedQueue, "moderation.completed.v1"); err != nil {
		return err
	}

	failedQueue := "messages.moderation.failed.q"
	if err := c.declareAndBind(ch, failedQueue, "moderation.failed.v1"); err != nil {
		return err
	}

	if err := ch.Qos(20, 0, false); err != nil {
		return fmt.Errorf("failed to set Qos: %w", err)
	}

	completedDeliveries, err := ch.Consume(
		completedQueue,
		"messages-moderation-completed-consumer",
		false, // manual ack
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed consuming from %s: %w", completedQueue, err)
	}

	failedDeliveries, err := ch.Consume(
		failedQueue,
		"messages-moderation-failed-consumer",
		false, // manual ack
		false,
		false,
		false,
		nil,
	)
	if err != nil {
		return fmt.Errorf("failed consuming from %s: %w", failedQueue, err)
	}

	slog.Info("RabbitMQ consumers initialized",
		"completedQueue", completedQueue,
		"failedQueue", failedQueue,
	)

	go c.processCompleted(ctx, completedDeliveries)
	go c.processFailed(ctx, failedDeliveries)

	return nil
}

func (c *RabbitMQConsumer) declareAndBind(ch *amqp.Channel, queue, routingKey string) error {
	if _, err := ch.QueueDeclare(
		queue,
		true,  // durable
		false, // delete when unused
		false, // exclusive
		false, // no-wait
		nil,
	); err != nil {
		return fmt.Errorf("failed declaring queue %s: %w", queue, err)
	}

	if err := ch.QueueBind(
		queue,
		routingKey,
		c.connection.ExchangeName(),
		false,
		nil,
	); err != nil {
		return fmt.Errorf("failed binding queue %s: %w", queue, err)
	}

	return nil
}

func (c *RabbitMQConsumer) processCompleted(ctx context.Context, deliveries <-chan amqp.Delivery) {
	for {
		select {
		case <-ctx.Done():
			slog.Info("Moderation completed consumer stopping...")
			return
		case d, ok := <-deliveries:
			if !ok {
				slog.Warn("Moderation completed deliveries channel closed")
				return
			}
			c.handleCompletedDelivery(ctx, d)
		}
	}
}

func (c *RabbitMQConsumer) handleCompletedDelivery(ctx context.Context, d amqp.Delivery) {
	var event schema.ModerationCompletedEvent
	if err := json.Unmarshal(d.Body, &event); err != nil {
		slog.Error("Failed to unmarshal moderation.completed.v1, discarding message", "error", err)
		_ = d.Ack(false)
		return
	}

	msgCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := c.handler.HandleModerationCompleted(msgCtx, &event); err != nil {
		slog.Error("Failed processing moderation.completed.v1, requeuing",
			"error", err,
			"messageId", event.Payload.MessageId,
		)
		_ = d.Nack(false, true)
		return
	}

	_ = d.Ack(false)
}

func (c *RabbitMQConsumer) processFailed(ctx context.Context, deliveries <-chan amqp.Delivery) {
	for {
		select {
		case <-ctx.Done():
			slog.Info("Moderation failed consumer stopping...")
			return
		case d, ok := <-deliveries:
			if !ok {
				slog.Warn("Moderation failed deliveries channel closed")
				return
			}
			c.handleFailedDelivery(ctx, d)
		}
	}
}

func (c *RabbitMQConsumer) handleFailedDelivery(ctx context.Context, d amqp.Delivery) {
	var event schema.ModerationFailedEvent
	if err := json.Unmarshal(d.Body, &event); err != nil {
		slog.Error("Failed to unmarshal moderation.failed.v1, discarding message", "error", err)
		_ = d.Ack(false)
		return
	}

	msgCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()

	if err := c.handler.HandleModerationFailed(msgCtx, &event); err != nil {
		slog.Error("Failed processing moderation.failed.v1, requeuing",
			"error", err,
			"messageId", event.Payload.MessageId,
		)
		_ = d.Nack(false, true)
		return
	}

	_ = d.Ack(false)
}
