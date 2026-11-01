package messaging

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

type RabbitMQConnection struct {
	url          string
	exchangeName string

	conn    *amqp.Connection
	channel *amqp.Channel
	mu      sync.RWMutex
	closed  bool
}

func NewRabbitMQConnection(url, exchangeName string) *RabbitMQConnection {
	return &RabbitMQConnection{
		url:          url,
		exchangeName: exchangeName,
	}
}

func (r *RabbitMQConnection) Connect() error {
	r.mu.Lock()
	defer r.mu.Unlock()

	conn, err := amqp.Dial(r.url)
	if err != nil {
		return fmt.Errorf("failed to connect to rabbitmq: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return fmt.Errorf("failed to open rabbitmq channel: %w", err)
	}

	// Declare exchange geopicto.events
	err = ch.ExchangeDeclare(
		r.exchangeName,
		"topic",
		true,  // durable
		false, // auto-deleted
		false, // internal
		false, // no-wait
		nil,   // arguments
	)
	if err != nil {
		ch.Close()
		conn.Close()
		return fmt.Errorf("failed to declare exchange: %w", err)
	}

	r.conn = conn
	r.channel = ch
	r.closed = false

	slog.Info("Connected to RabbitMQ", "exchange", r.exchangeName)
	return nil
}

func (r *RabbitMQConnection) Channel() *amqp.Channel {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.channel
}

func (r *RabbitMQConnection) ExchangeName() string {
	return r.exchangeName
}

func (r *RabbitMQConnection) IsHealthy() bool {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.conn != nil && !r.conn.IsClosed()
}

func (r *RabbitMQConnection) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.closed = true
	if r.channel != nil {
		_ = r.channel.Close()
	}
	if r.conn != nil {
		_ = r.conn.Close()
	}
}

// EnsureConnection checks if connected, and attempts to reconnect if not.
func (r *RabbitMQConnection) EnsureConnection(ctx context.Context) error {
	if r.IsHealthy() {
		return nil
	}

	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-ticker.C:
			slog.Info("Attempting to reconnect to RabbitMQ...")
			if err := r.Connect(); err == nil {
				return nil
			}
		}
	}
}
