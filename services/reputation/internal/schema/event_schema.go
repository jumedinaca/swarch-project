package schema

import (
	"time"

	"github.com/google/uuid"
)

// RatingChangedPayload corresponds to rating.changed.v1 payload.
type RatingChangedPayload struct {
	RatingId        string    `json:"ratingId"`
	MessageId       uuid.UUID `json:"messageId"`
	MessageAuthorId uuid.UUID `json:"messageAuthorId"`
	RaterId         uuid.UUID `json:"raterId"`
	PreviousValue   int       `json:"previousValue"`
	Value           int       `json:"value"`
	Likes           int       `json:"likes"`
	Dislikes        int       `json:"dislikes"`
	ChangedAt       time.Time `json:"changedAt"`
}

// RatingChangedEvent envelope.
type RatingChangedEvent struct {
	EventId       uuid.UUID            `json:"eventId"`
	EventType     string               `json:"eventType"`
	Version       int                  `json:"version"`
	OccurredAt    time.Time            `json:"occurredAt"`
	Producer      string               `json:"producer"`
	CorrelationId uuid.UUID            `json:"correlationId"`
	CausationId   *uuid.UUID           `json:"causationId,omitempty"`
	Payload       RatingChangedPayload `json:"payload"`
}

// ModerationCompletedPayload corresponds to moderation.completed.v1 payload.
type ModerationCompletedPayload struct {
	MessageId      uuid.UUID `json:"messageId"`
	AuthorId       uuid.UUID `json:"authorId"`
	MessageVersion int       `json:"messageVersion"`
	Decision       string    `json:"decision"`
	Confidence     float64   `json:"confidence"`
	Reasons        []string  `json:"reasons"`
	ModelVersion   string    `json:"modelVersion"`
	RuleVersion    string    `json:"ruleVersion"`
	Degraded       bool      `json:"degraded"`
	DecidedAt      time.Time `json:"decidedAt"`
}

// ModerationCompletedEvent envelope.
type ModerationCompletedEvent struct {
	EventId       uuid.UUID                  `json:"eventId"`
	EventType     string                     `json:"eventType"`
	Version       int                        `json:"version"`
	OccurredAt    time.Time                  `json:"occurredAt"`
	Producer      string                     `json:"producer"`
	CorrelationId uuid.UUID                  `json:"correlationId"`
	CausationId   *uuid.UUID                 `json:"causationId,omitempty"`
	Payload       ModerationCompletedPayload `json:"payload"`
}

// ReputationChangedPayload corresponds to reputation.changed.v1 payload.
type ReputationChangedPayload struct {
	UserId        uuid.UUID `json:"userId"`
	PreviousScore int       `json:"previousScore"`
	Score         int       `json:"score"`
	Delta         int       `json:"delta"`
	PreviousLevel string    `json:"previousLevel"`
	Level         string    `json:"level"`
	LevelChanged  bool      `json:"levelChanged"`
	Reason        string    `json:"reason"`
	SourceEventId uuid.UUID `json:"sourceEventId"`
	OccurredAt    string    `json:"occurredAt"`
}

// ReputationChangedEvent envelope.
type ReputationChangedEvent struct {
	EventId       uuid.UUID                `json:"eventId"`
	EventType     string                   `json:"eventType"`
	Version       int                      `json:"version"`
	OccurredAt    string                   `json:"occurredAt"`
	Producer      string                   `json:"producer"`
	CorrelationId uuid.UUID                `json:"correlationId"`
	CausationId   *uuid.UUID               `json:"causationId,omitempty"`
	Payload       ReputationChangedPayload `json:"payload"`
}
