package messaging

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

const connectionTimeout = 5 * time.Second

type RabbitMQConnection struct {
	url          string
	exchangeName string

	mu      sync.RWMutex
	conn    *amqp.Connection
	channel *amqp.Channel
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

	conn, err := amqp.DialConfig(r.url, amqp.Config{
		Dial: amqp.DefaultDial(connectionTimeout),
	})
	if err != nil {
		return fmt.Errorf("failed to connect to rabbitmq: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		_ = conn.Close()
		return fmt.Errorf("failed to open rabbitmq channel: %w", err)
	}

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
		_ = ch.Close()
		_ = conn.Close()
		return fmt.Errorf("failed to declare exchange: %w", err)
	}

	if r.channel != nil {
		_ = r.channel.Close()
	}
	if r.conn != nil {
		_ = r.conn.Close()
	}

	r.conn = conn
	r.channel = ch

	slog.Info("Connected to RabbitMQ", "exchange", r.exchangeName)
	return nil
}

// EnsureConnected reintenta la conexión solo cuando hace falta. Si RabbitMQ
// está caído devuelve el error y quien publica decide si lo registra o no.
func (r *RabbitMQConnection) EnsureConnected() error {
	if r.IsHealthy() {
		return nil
	}
	return r.Connect()
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
	return r.conn != nil &&
		!r.conn.IsClosed() &&
		r.channel != nil &&
		!r.channel.IsClosed()
}

func (r *RabbitMQConnection) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()

	if r.channel != nil {
		_ = r.channel.Close()
		r.channel = nil
	}
	if r.conn != nil {
		_ = r.conn.Close()
		r.conn = nil
	}
}
