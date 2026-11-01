package domain

import (
	"time"

	"github.com/google/uuid"
)

const (
	ReasonLikeReceived     = "LIKE_RECEIVED"
	ReasonDislikeReceived  = "DISLIKE_RECEIVED"
	ReasonMessageAllowed   = "MESSAGE_ALLOWED"
	ReasonMessageWarned    = "MESSAGE_WARNED"
	ReasonMessageBlocked   = "MESSAGE_BLOCKED"
	ReasonAdminAdjustment  = "ADMIN_ADJUSTMENT"
)

type UserReputation struct {
	UserID           uuid.UUID `json:"userId"`
	Score            int       `json:"score"`
	Level            string    `json:"level"`
	LikesReceived    int       `json:"likesReceived"`
	DislikesReceived int       `json:"dislikesReceived"`
	MessagesBlocked  int       `json:"messagesBlocked"`
	MessagesWarned   int       `json:"messagesWarned"`
	Version          int       `json:"version"`
	UpdatedAt        time.Time `json:"updatedAt"`
}

type ReputationLedger struct {
	ID            uuid.UUID `json:"id"`
	UserID        uuid.UUID `json:"userId"`
	Delta         int       `json:"delta"`
	AppliedDelta  int       `json:"appliedDelta"`
	Reason        string    `json:"reason"`
	SourceEventID uuid.UUID `json:"sourceEventId"`
	DedupeKey     string    `json:"dedupeKey"`
	ScoreAfter    int       `json:"scoreAfter"`
	CreatedAt     time.Time `json:"createdAt"`
}

// AppliedChange represents the result of applying a reputation change.
type AppliedChange struct {
	UserID        uuid.UUID
	PreviousScore int
	Score         int
	Delta         int
	AppliedDelta  int
	PreviousLevel string
	Level         string
	LevelChanged  bool
	Reason        string
	SourceEventID uuid.UUID
	OccurredAt    time.Time
	ScoreAfter    int
}
