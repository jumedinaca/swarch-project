package schema

import (
	"github.com/google/uuid"
)

type MessageOut struct {
	ID		  uuid.UUID `json:"id"`
	SenderID  uuid.UUID `json:"sender_id"`
	Content   string    `json:"content"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
}

type CreateMessageRequest struct {
	Content   string    `json:"content"`
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
}

type NearbyRequest struct {
	Latitude  float64   `json:"latitude"`
	Longitude float64   `json:"longitude"`
	Radius	  float64 	`json:"radius"`
}