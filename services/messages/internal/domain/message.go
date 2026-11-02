package domain

import (
	"time"

	"github.com/google/uuid"
)

type MessageStatus string

const (
	StatusPending   MessageStatus = "PENDING"
	StatusPublished MessageStatus = "PUBLISHED"
	StatusBlocked   MessageStatus = "BLOCKED"
	StatusDeleted   MessageStatus = "DELETED"
)

type ModerationStatus string

const (
	ModerationPending  ModerationStatus = "PENDING"
	ModerationAllow    ModerationStatus = "ALLOW"
	ModerationWarn     ModerationStatus = "WARN"
	ModerationBlock    ModerationStatus = "BLOCK"
	ModerationReview   ModerationStatus = "REVIEW"
	ModerationDegraded ModerationStatus = "DEGRADED"
)

type Message struct {
	ID               uuid.UUID         `json:"id"`
	SenderID         uuid.UUID         `json:"sender_id"`
	Content          string            `json:"content"`
	Location         Location          `json:"location"`
	Status           MessageStatus     `json:"status"`
	ModerationStatus *ModerationStatus `json:"moderation_status"`
	ModerationReason *string           `json:"moderation_reason,omitempty"`
	Version          int32             `json:"version"`
	CreatedAt        time.Time         `json:"created_at"`
	UpdatedAt        time.Time         `json:"updated_at"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}
