// Package domain contiene las reglas puras del voto: valores validos, cuando
// un mensaje se puede votar y como cambian los conteos.
package domain

import (
	"errors"
	"time"

	"github.com/google/uuid"
)

// Value es el voto de un usuario sobre un mensaje. None representa la
// ausencia de voto (y es el "value: 0" del evento cuando se elimina).
type Value int16

const (
	None    Value = 0
	Like    Value = 1
	Dislike Value = -1
)

const (
	LabelLike    = "LIKE"
	LabelDislike = "DISLIKE"
)

var (
	ErrMessageNotFound    = errors.New("message_not_found")
	ErrMessageNotReady    = errors.New("message_not_ready")
	ErrMessageNotRateable = errors.New("message_not_rateable")
	ErrSelfRating         = errors.New("self_rating_forbidden")
	ErrInvalidValue       = errors.New("invalid_rating_value")
)

// ParseValue convierte "LIKE"/"DISLIKE" en un Value. Cualquier otro texto es
// invalido; para quitar el voto se usa DELETE, no un valor especial.
func ParseValue(s string) (Value, error) {
	switch s {
	case LabelLike:
		return Like, nil
	case LabelDislike:
		return Dislike, nil
	default:
		return None, ErrInvalidValue
	}
}

// Label devuelve "LIKE", "DISLIKE" o nil si no hay voto.
func (v Value) Label() *string {
	var s string
	switch v {
	case Like:
		s = LabelLike
	case Dislike:
		s = LabelDislike
	default:
		return nil
	}
	return &s
}

type MessageStatus string

const (
	StatusPublished MessageStatus = "PUBLISHED"
	StatusBlocked   MessageStatus = "BLOCKED"
	StatusDeleted   MessageStatus = "DELETED"
)

// MessageProjection es la copia local de lo que rating necesita saber de un
// mensaje, construida a partir de los eventos de messages.
type MessageProjection struct {
	MessageID   uuid.UUID
	AuthorID    uuid.UUID
	Status      MessageStatus
	PublishedAt time.Time
}

// CheckRateable aplica las reglas para votar (o quitar el voto de) un mensaje.
// proj es nil cuando el mensaje todavia no llego a la proyeccion.
func CheckRateable(proj *MessageProjection, raterID uuid.UUID) error {
	if proj == nil {
		return ErrMessageNotReady
	}
	if proj.Status != StatusPublished {
		return ErrMessageNotRateable
	}
	if proj.AuthorID == raterID {
		return ErrSelfRating
	}
	return nil
}

// ApplyVote devuelve los conteos tras pasar del voto prev al voto next.
func ApplyVote(likes, dislikes int, prev, next Value) (int, int) {
	switch prev {
	case Like:
		likes--
	case Dislike:
		dislikes--
	}
	switch next {
	case Like:
		likes++
	case Dislike:
		dislikes++
	}
	return likes, dislikes
}

// Summary son los conteos agregados de un mensaje y el voto de quien consulta.
type Summary struct {
	MessageID uuid.UUID
	Likes     int
	Dislikes  int
	MyRating  Value
}

func (s Summary) Score() int { return s.Likes - s.Dislikes }

// VoteChange es el resultado de aplicar un voto. Changed es false cuando el
// voto ya era el pedido (PUT repetido o DELETE sin voto): en ese caso no se
// modifico nada y no se debe emitir evento.
type VoteChange struct {
	Changed   bool
	RatingID  uuid.UUID
	MessageID uuid.UUID
	AuthorID  uuid.UUID
	RaterID   uuid.UUID
	Previous  Value
	Value     Value
	Likes     int
	Dislikes  int
	ChangedAt time.Time
}

func (c *VoteChange) Summary() Summary {
	return Summary{
		MessageID: c.MessageID,
		Likes:     c.Likes,
		Dislikes:  c.Dislikes,
		MyRating:  c.Value,
	}
}
