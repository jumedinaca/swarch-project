package repository

import (
	"context"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
)

// RatingRepository es el puerto de persistencia del servicio.
type RatingRepository interface {
	// SetVote deja el voto de raterID sobre messageID en value (None lo
	// elimina). Valida las reglas del mensaje, lee el voto anterior y ajusta
	// los conteos en una sola transaccion. Devuelve los errores de dominio
	// ErrMessageNotReady, ErrMessageNotRateable o ErrSelfRating.
	SetVote(ctx context.Context, messageID, raterID uuid.UUID, value domain.Value) (*domain.VoteChange, error)

	// GetProjection devuelve nil si el mensaje no esta en la proyeccion.
	GetProjection(ctx context.Context, messageID uuid.UUID) (*domain.MessageProjection, error)

	// GetSummaries devuelve un resumen por id, en el mismo orden, con una
	// sola consulta. Los mensajes sin votos devuelven conteos en cero.
	GetSummaries(ctx context.Context, messageIDs []uuid.UUID, userID uuid.UUID) ([]domain.Summary, error)

	// UpsertPublished registra un mensaje publicado. Si ya estaba marcado
	// como DELETED (el borrado llego antes), sigue DELETED.
	UpsertPublished(ctx context.Context, messageID, authorID uuid.UUID, publishedAt time.Time) error

	// MarkDeleted marca el mensaje como DELETED, creandolo si no existia.
	MarkDeleted(ctx context.Context, messageID, authorID uuid.UUID, deletedAt time.Time) error
}
