package messaging

import (
	"context"
	"fmt"
	"log/slog"
	"sync"
	"time"

	amqp "github.com/rabbitmq/amqp091-go"
)

// SetupFunc se ejecuta cada vez que se (re)establece la conexion; la usan
// los consumidores para declarar sus colas y empezar a consumir.
type SetupFunc func(ctx context.Context, conn *amqp.Connection, exchange string) error

// Broker mantiene la conexion con RabbitMQ y se reconecta sola. El servicio
// funciona sin broker: los votos se guardan y los eventos se pierden (P2).
type Broker struct {
	url      string
	exchange string

	mu    sync.RWMutex
	conn  *amqp.Connection
	pubCh *amqp.Channel
	// pubMu serializa las publicaciones sobre el canal compartido.
	pubMu sync.Mutex

	setups []SetupFunc
}

func NewBroker(url, exchange string) *Broker {
	return &Broker{url: url, exchange: exchange}
}

// OnConnect registra una funcion de inicializacion. Llamar antes de Run.
func (b *Broker) OnConnect(fn SetupFunc) {
	b.setups = append(b.setups, fn)
}

func (b *Broker) Exchange() string { return b.exchange }

func (b *Broker) IsHealthy() bool {
	b.mu.RLock()
	defer b.mu.RUnlock()
	return b.conn != nil && !b.conn.IsClosed() && b.pubCh != nil && !b.pubCh.IsClosed()
}

// Run conecta y reconecta hasta que ctx se cancela.
func (b *Broker) Run(ctx context.Context) {
	backoff := time.Second
	for {
		closed, err := b.connect(ctx)
		if err != nil {
			slog.Warn("RabbitMQ unavailable, retrying", "error", err, "retryIn", backoff.String())
			select {
			case <-ctx.Done():
				return
			case <-time.After(backoff):
			}
			backoff = min(backoff*2, 30*time.Second)
			continue
		}
		backoff = time.Second

		select {
		case <-ctx.Done():
			b.close()
			return
		case amqpErr := <-closed:
			slog.Warn("RabbitMQ connection lost, reconnecting", "error", amqpErr)
			b.close()
		}
	}
}

func (b *Broker) connect(ctx context.Context) (chan *amqp.Error, error) {
	conn, err := amqp.Dial(b.url)
	if err != nil {
		return nil, fmt.Errorf("dial: %w", err)
	}

	ch, err := conn.Channel()
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("open channel: %w", err)
	}
	if err := ch.ExchangeDeclare(b.exchange, "topic", true, false, false, false, nil); err != nil {
		conn.Close()
		return nil, fmt.Errorf("declare exchange %s: %w", b.exchange, err)
	}

	for _, setup := range b.setups {
		if err := setup(ctx, conn, b.exchange); err != nil {
			conn.Close()
			return nil, err
		}
	}

	closed := conn.NotifyClose(make(chan *amqp.Error, 1))

	b.mu.Lock()
	b.conn = conn
	b.pubCh = ch
	b.mu.Unlock()

	slog.Info("Connected to RabbitMQ", "exchange", b.exchange)
	return closed, nil
}

func (b *Broker) close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.conn != nil {
		_ = b.conn.Close()
	}
	b.conn = nil
	b.pubCh = nil
}

// Close cierra la conexion actual (para el apagado).
func (b *Broker) Close() { b.close() }

// Publish envia un mensaje persistente al exchange.
func (b *Broker) Publish(ctx context.Context, routingKey string, msg amqp.Publishing) error {
	b.mu.RLock()
	ch := b.pubCh
	b.mu.RUnlock()
	if ch == nil || ch.IsClosed() {
		return fmt.Errorf("rabbitmq not connected")
	}

	b.pubMu.Lock()
	defer b.pubMu.Unlock()
	return ch.PublishWithContext(ctx, b.exchange, routingKey, false, false, msg)
}
