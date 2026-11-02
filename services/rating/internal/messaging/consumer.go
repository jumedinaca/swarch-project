package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"rating/internal/schema"
)

const (
	QueueMessagePublished = "rating.message.published.q"
	QueueMessageDeleted   = "rating.message.deleted.q"
)

// MessageEventHandler aplica los eventos de messages sobre la proyeccion.
type MessageEventHandler interface {
	HandleMessagePublished(ctx context.Context, evt *schema.IncomingEvent, p *schema.MessagePublishedPayload) error
	HandleMessageDeleted(ctx context.Context, evt *schema.IncomingEvent, p *schema.MessageDeletedPayload) error
}

// errPoison marca un mensaje que nunca se va a poder procesar (JSON invalido,
// campos obligatorios ausentes). Se descarta en vez de reencolarlo.
var errPoison = errors.New("poison message")

type Consumer struct {
	handler MessageEventHandler
}

func NewConsumer(h MessageEventHandler) *Consumer {
	return &Consumer{handler: h}
}

// Setup declara las colas, las enlaza al exchange y empieza a consumir. Se
// registra con Broker.OnConnect para que se repita en cada reconexion.
func (c *Consumer) Setup(ctx context.Context, conn *amqp.Connection, exchange string) error {
	bindings := []struct {
		queue, routingKey string
		handle            func(context.Context, []byte) error
	}{
		{QueueMessagePublished, schema.EventMessagePublished, c.handlePublished},
		{QueueMessageDeleted, schema.EventMessageDeleted, c.handleDeleted},
	}

	for _, bnd := range bindings {
		ch, err := conn.Channel()
		if err != nil {
			return fmt.Errorf("open consumer channel: %w", err)
		}
		if _, err := ch.QueueDeclare(bnd.queue, true, false, false, false, nil); err != nil {
			return fmt.Errorf("declare queue %s: %w", bnd.queue, err)
		}
		if err := ch.QueueBind(bnd.queue, bnd.routingKey, exchange, false, nil); err != nil {
			return fmt.Errorf("bind queue %s: %w", bnd.queue, err)
		}
		if err := ch.Qos(20, 0, false); err != nil {
			return fmt.Errorf("set qos on %s: %w", bnd.queue, err)
		}
		deliveries, err := ch.Consume(bnd.queue, "rating-"+bnd.queue, false, false, false, false, nil)
		if err != nil {
			return fmt.Errorf("consume %s: %w", bnd.queue, err)
		}
		go c.loop(ctx, bnd.queue, deliveries, bnd.handle)
	}
	return nil
}

func (c *Consumer) loop(ctx context.Context, queue string, deliveries <-chan amqp.Delivery, handle func(context.Context, []byte) error) {
	slog.Info("Consuming queue", "queue", queue)
	for d := range deliveries {
		err := handle(ctx, d.Body)
		switch {
		case err == nil:
			_ = d.Ack(false)
		case errors.Is(err, errPoison):
			slog.Error("Discarding invalid event", "queue", queue, "error", err)
			_ = d.Nack(false, false)
		default:
			// Error transitorio (p. ej. base de datos): se reencola tras una
			// pausa corta para no girar en caliente.
			slog.Error("Failed processing event, requeueing", "queue", queue, "error", err)
			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
			}
			_ = d.Nack(false, true)
		}
	}
	slog.Info("Delivery channel closed", "queue", queue)
}

func decode(body []byte) (*schema.IncomingEvent, error) {
	var evt schema.IncomingEvent
	if err := json.Unmarshal(body, &evt); err != nil {
		return nil, fmt.Errorf("%w: invalid envelope: %v", errPoison, err)
	}
	if len(evt.Payload) == 0 {
		return nil, fmt.Errorf("%w: missing payload", errPoison)
	}
	return &evt, nil
}

func (c *Consumer) handlePublished(ctx context.Context, body []byte) error {
	evt, err := decode(body)
	if err != nil {
		return err
	}
	var p schema.MessagePublishedPayload
	if err := json.Unmarshal(evt.Payload, &p); err != nil {
		return fmt.Errorf("%w: invalid message.published payload: %v", errPoison, err)
	}
	if p.MessageID == uuid.Nil || p.AuthorID == uuid.Nil {
		return fmt.Errorf("%w: message.published without messageId or authorId", errPoison)
	}
	return c.handler.HandleMessagePublished(ctx, evt, &p)
}

func (c *Consumer) handleDeleted(ctx context.Context, body []byte) error {
	evt, err := decode(body)
	if err != nil {
		return err
	}
	var p schema.MessageDeletedPayload
	if err := json.Unmarshal(evt.Payload, &p); err != nil {
		return fmt.Errorf("%w: invalid message.deleted payload: %v", errPoison, err)
	}
	if p.MessageID == uuid.Nil {
		return fmt.Errorf("%w: message.deleted without messageId", errPoison)
	}
	return c.handler.HandleMessageDeleted(ctx, evt, &p)
}
