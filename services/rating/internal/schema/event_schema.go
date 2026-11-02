package schema

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

const (
	EventRatingChanged    = "rating.changed.v1"
	EventMessagePublished = "message.published.v1"
	EventMessageDeleted   = "message.deleted.v1"

	Producer = "rating"
)

// IncomingEvent es el sobre comun de los eventos que consume rating. El
// payload se decodifica despues segun eventType. correlationId se lee como
// texto para no rechazar eventos de productores que no usen UUID.
type IncomingEvent struct {
	EventID       string          `json:"eventId"`
	EventType     string          `json:"eventType"`
	Version       int             `json:"version"`
	OccurredAt    time.Time       `json:"occurredAt"`
	Producer      string          `json:"producer"`
	CorrelationID string          `json:"correlationId"`
	Payload       json.RawMessage `json:"payload"`
}

// MessagePublishedPayload corresponde a message.published.v1.
type MessagePublishedPayload struct {
	MessageID          uuid.UUID `json:"messageId"`
	AuthorID           uuid.UUID `json:"authorId"`
	ModerationDecision string    `json:"moderationDecision"`
	PublishedAt        time.Time `json:"publishedAt"`
}

// MessageDeletedPayload corresponde a message.deleted.v1. authorId es
// opcional: solo se usa si el borrado llega antes que la publicacion.
type MessageDeletedPayload struct {
	MessageID uuid.UUID `json:"messageId"`
	AuthorID  uuid.UUID `json:"authorId"`
	DeletedAt time.Time `json:"deletedAt"`
}

// RatingChangedPayload corresponde a rating.changed.v1. previousValue y value
// son -1, 0 o 1 (0 = sin voto).
type RatingChangedPayload struct {
	RatingID        uuid.UUID `json:"ratingId"`
	MessageID       uuid.UUID `json:"messageId"`
	MessageAuthorID uuid.UUID `json:"messageAuthorId"`
	RaterID         uuid.UUID `json:"raterId"`
	PreviousValue   int       `json:"previousValue"`
	Value           int       `json:"value"`
	Likes           int       `json:"likes"`
	Dislikes        int       `json:"dislikes"`
	ChangedAt       time.Time `json:"changedAt"`
}

type RatingChangedEvent struct {
	EventID       uuid.UUID            `json:"eventId"`
	EventType     string               `json:"eventType"`
	Version       int                  `json:"version"`
	OccurredAt    time.Time            `json:"occurredAt"`
	Producer      string               `json:"producer"`
	CorrelationID string               `json:"correlationId"`
	CausationID   *string              `json:"causationId"`
	Payload       RatingChangedPayload `json:"payload"`
}
