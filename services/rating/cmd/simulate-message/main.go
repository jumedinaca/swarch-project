// simulate-message publica un evento message.published.v1 o
// message.deleted.v1 en el broker. Sirve para probar rating mientras el
// servicio de mensajes aun no publica esos eventos.
//
//	simulate-message -message <uuid> -author <uuid>            # publicado
//	simulate-message -message <uuid> -author <uuid> -deleted   # eliminado
//
// Usa RABBITMQ_URL y RABBITMQ_EXCHANGE, igual que el servicio.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"

	"rating/internal/schema"
)

func main() {
	messageID := flag.String("message", "", "UUID del mensaje (obligatorio)")
	authorID := flag.String("author", "", "UUID del autor (obligatorio para publicar)")
	deleted := flag.Bool("deleted", false, "publicar message.deleted.v1 en vez de message.published.v1")
	flag.Parse()

	msgID, err := uuid.Parse(*messageID)
	if err != nil {
		fail("-message debe ser un UUID")
	}
	var author uuid.UUID
	if *authorID != "" {
		if author, err = uuid.Parse(*authorID); err != nil {
			fail("-author debe ser un UUID")
		}
	} else if !*deleted {
		fail("-author es obligatorio para message.published.v1")
	}

	url := envOr("RABBITMQ_URL", "amqp://geopicto:geopicto@localhost:5672/geopicto")
	exchange := envOr("RABBITMQ_EXCHANGE", "geopicto.events")

	now := time.Now().UTC()
	eventType := schema.EventMessagePublished
	var payload any = schema.MessagePublishedPayload{
		MessageID: msgID, AuthorID: author, ModerationDecision: "ALLOW", PublishedAt: now,
	}
	if *deleted {
		eventType = schema.EventMessageDeleted
		payload = schema.MessageDeletedPayload{MessageID: msgID, AuthorID: author, DeletedAt: now}
	}

	eventID := uuid.Must(uuid.NewV7())
	body, _ := json.Marshal(map[string]any{
		"eventId":       eventID,
		"eventType":     eventType,
		"version":       1,
		"occurredAt":    now,
		"producer":      "messages",
		"correlationId": eventID,
		"causationId":   nil,
		"payload":       payload,
	})

	conn, err := amqp.Dial(url)
	if err != nil {
		fail("no se pudo conectar a RabbitMQ: " + err.Error())
	}
	defer conn.Close()
	ch, err := conn.Channel()
	if err != nil {
		fail(err.Error())
	}
	if err := ch.ExchangeDeclare(exchange, "topic", true, false, false, false, nil); err != nil {
		fail(err.Error())
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err = ch.PublishWithContext(ctx, exchange, eventType, false, false, amqp.Publishing{
		DeliveryMode: amqp.Persistent,
		ContentType:  "application/json",
		MessageId:    eventID.String(),
		Type:         eventType,
		Body:         body,
	})
	if err != nil {
		fail(err.Error())
	}
	fmt.Printf("%s publicado para el mensaje %s\n", eventType, msgID)
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
