package domain

import (
	"time"
	"github.com/google/uuid"
)

type Message struct {
	ID        uuid.UUID `json:"id"`
	SenderID  uuid.UUID `json:"sender_id"`
	Content   string    `json:"content"`
	Location  Location  `json:"location"`
	CreatedAt time.Time `json:"created_at"`
}

type Location struct {
	Latitude  float64 `json:"latitude"`
	Longitude float64 `json:"longitude"`
}