package schema

import (
	"time"

	"github.com/google/uuid"
)

// MessageSubmittedPayload corresponde al payload de message.submitted.v1.
type MessageSubmittedPayload struct {
	MessageId      uuid.UUID `json:"messageId"`
	AuthorId       uuid.UUID `json:"authorId"`
	Content        string    `json:"content"`
	Latitude       float64   `json:"latitude"`
	Longitude      float64   `json:"longitude"`
	MessageVersion int32     `json:"messageVersion"`
	CreatedAt      time.Time `json:"createdAt"`
}

type MessageSubmittedEvent struct {
	EventId       uuid.UUID               `json:"eventId"`
	EventType     string                  `json:"eventType"`
	Version       int                     `json:"version"`
	OccurredAt    time.Time               `json:"occurredAt"`
	Producer      string                  `json:"producer"`
	CorrelationId uuid.UUID               `json:"correlationId"`
	CausationId   *uuid.UUID              `json:"causationId"`
	Payload       MessageSubmittedPayload `json:"payload"`
}

// MessagePublishedPayload corresponde al payload de message.published.v1.
type MessagePublishedPayload struct {
	MessageId          uuid.UUID `json:"messageId"`
	AuthorId           uuid.UUID `json:"authorId"`
	ContentPreview     string    `json:"contentPreview"`
	Latitude           float64   `json:"latitude"`
	Longitude          float64   `json:"longitude"`
	ModerationDecision string    `json:"moderationDecision"`
	PublishedAt        time.Time `json:"publishedAt"`
}

type MessagePublishedEvent struct {
	EventId       uuid.UUID               `json:"eventId"`
	EventType     string                  `json:"eventType"`
	Version       int                     `json:"version"`
	OccurredAt    time.Time               `json:"occurredAt"`
	Producer      string                  `json:"producer"`
	CorrelationId uuid.UUID               `json:"correlationId"`
	CausationId   *uuid.UUID              `json:"causationId"`
	Payload       MessagePublishedPayload `json:"payload"`
}

// MessageDeletedPayload corresponde al payload de message.deleted.v1.
type MessageDeletedPayload struct {
	MessageId      uuid.UUID `json:"messageId"`
	AuthorId       uuid.UUID `json:"authorId"`
	MessageVersion int32     `json:"messageVersion"`
	DeletedAt      time.Time `json:"deletedAt"`
}

type MessageDeletedEvent struct {
	EventId       uuid.UUID             `json:"eventId"`
	EventType     string                `json:"eventType"`
	Version       int                   `json:"version"`
	OccurredAt    time.Time             `json:"occurredAt"`
	Producer      string                `json:"producer"`
	CorrelationId uuid.UUID             `json:"correlationId"`
	CausationId   *uuid.UUID            `json:"causationId"`
	Payload       MessageDeletedPayload `json:"payload"`
}

// ModerationCompletedPayload corresponde al payload de moderation.completed.v1.
type ModerationCompletedPayload struct {
	MessageId      uuid.UUID `json:"messageId"`
	AuthorId       uuid.UUID `json:"authorId"`
	MessageVersion int32     `json:"messageVersion"`
	Decision       string    `json:"decision"`
	Confidence     float64   `json:"confidence"`
	Reasons        []string  `json:"reasons"`
	ModelVersion   string    `json:"modelVersion"`
	RuleVersion    string    `json:"ruleVersion"`
	Degraded       bool      `json:"degraded"`
	DecidedAt      time.Time `json:"decidedAt"`
}

type ModerationCompletedEvent struct {
	EventId       uuid.UUID                  `json:"eventId"`
	EventType     string                     `json:"eventType"`
	Version       int                        `json:"version"`
	OccurredAt    time.Time                  `json:"occurredAt"`
	Producer      string                     `json:"producer"`
	CorrelationId uuid.UUID                  `json:"correlationId"`
	CausationId   *uuid.UUID                 `json:"causationId"`
	Payload       ModerationCompletedPayload `json:"payload"`
}

// ModerationFailedPayload corresponde al payload de moderation.failed.v1.
type ModerationFailedPayload struct {
	MessageId      uuid.UUID `json:"messageId"`
	AuthorId       uuid.UUID `json:"authorId"`
	MessageVersion int32     `json:"messageVersion"`
	Reason         string    `json:"reason"`
	FailedAt       time.Time `json:"failedAt"`
}

type ModerationFailedEvent struct {
	EventId       uuid.UUID               `json:"eventId"`
	EventType     string                  `json:"eventType"`
	Version       int                     `json:"version"`
	OccurredAt    time.Time               `json:"occurredAt"`
	Producer      string                  `json:"producer"`
	CorrelationId uuid.UUID               `json:"correlationId"`
	CausationId   *uuid.UUID              `json:"causationId"`
	Payload       ModerationFailedPayload `json:"payload"`
}
