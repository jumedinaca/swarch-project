package service

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
	"rating/internal/repository"
	"rating/internal/schema"
)

// EventPublisher publica rating.changed.v1. Una falla al publicar no revierte
// el voto: en P2 no hay outbox, el evento se pierde y se registra el error.
type EventPublisher interface {
	PublishRatingChanged(ctx context.Context, change *domain.VoteChange, correlationID string) error
}

const publishTimeout = 2 * time.Second

type RatingService struct {
	repo      repository.RatingRepository
	publisher EventPublisher
}

func NewRatingService(repo repository.RatingRepository, publisher EventPublisher) *RatingService {
	return &RatingService{repo: repo, publisher: publisher}
}

// Rate deja el voto LIKE/DISLIKE del usuario. Repetir el mismo voto no cambia
// nada ni emite evento.
func (s *RatingService) Rate(ctx context.Context, raterID, messageID uuid.UUID, value domain.Value, correlationID string) (domain.Summary, error) {
	if value != domain.Like && value != domain.Dislike {
		return domain.Summary{}, domain.ErrInvalidValue
	}
	return s.setVote(ctx, raterID, messageID, value, correlationID)
}

// Remove quita el voto del usuario y emite value 0 si habia uno.
func (s *RatingService) Remove(ctx context.Context, raterID, messageID uuid.UUID, correlationID string) (domain.Summary, error) {
	return s.setVote(ctx, raterID, messageID, domain.None, correlationID)
}

func (s *RatingService) setVote(ctx context.Context, raterID, messageID uuid.UUID, value domain.Value, correlationID string) (domain.Summary, error) {
	change, err := s.repo.SetVote(ctx, messageID, raterID, value)
	if err != nil {
		return domain.Summary{}, err
	}

	// El evento sale despues del commit y solo si el voto cambio de verdad.
	if change.Changed && s.publisher != nil {
		// Contexto propio: si el cliente corta la conexion, el voto ya esta
		// guardado y el evento se debe intentar igual.
		pubCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), publishTimeout)
		defer cancel()
		if err := s.publisher.PublishRatingChanged(pubCtx, change, correlationID); err != nil {
			slog.Error("rating.changed.v1 lost: vote persisted but event not published",
				"error", err,
				"messageId", change.MessageID,
				"raterId", change.RaterID,
				"previousValue", int(change.Previous),
				"value", int(change.Value),
			)
		}
	}

	return change.Summary(), nil
}

// Get devuelve el resumen de un mensaje. Los mensajes que rating no conoce o
// que fueron eliminados responden ErrMessageNotFound.
func (s *RatingService) Get(ctx context.Context, userID, messageID uuid.UUID) (domain.Summary, error) {
	proj, err := s.repo.GetProjection(ctx, messageID)
	if err != nil {
		return domain.Summary{}, err
	}
	if proj == nil || proj.Status == domain.StatusDeleted {
		return domain.Summary{}, domain.ErrMessageNotFound
	}

	summaries, err := s.repo.GetSummaries(ctx, []uuid.UUID{messageID}, userID)
	if err != nil {
		return domain.Summary{}, err
	}
	if len(summaries) != 1 {
		return domain.Summary{}, fmt.Errorf("expected 1 summary, got %d", len(summaries))
	}
	return summaries[0], nil
}

// Batch devuelve un resumen por cada id (sin repetir, en el orden pedido) con
// una sola consulta. Los ids sin votos devuelven conteos en cero.
func (s *RatingService) Batch(ctx context.Context, userID uuid.UUID, messageIDs []uuid.UUID) ([]domain.Summary, error) {
	seen := make(map[uuid.UUID]struct{}, len(messageIDs))
	unique := make([]uuid.UUID, 0, len(messageIDs))
	for _, id := range messageIDs {
		if _, ok := seen[id]; ok {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	return s.repo.GetSummaries(ctx, unique, userID)
}

// HandleMessagePublished actualiza la proyeccion con message.published.v1.
// Es idempotente por messageId: reprocesar el evento deja el mismo estado.
func (s *RatingService) HandleMessagePublished(ctx context.Context, evt *schema.IncomingEvent, p *schema.MessagePublishedPayload) error {
	publishedAt := p.PublishedAt
	if publishedAt.IsZero() {
		publishedAt = evt.OccurredAt
	}
	if publishedAt.IsZero() {
		publishedAt = time.Now().UTC()
	}
	if err := s.repo.UpsertPublished(ctx, p.MessageID, p.AuthorID, publishedAt); err != nil {
		return err
	}
	slog.Info("Message projection published", "messageId", p.MessageID, "eventId", evt.EventID)
	return nil
}

// HandleMessageDeleted marca el mensaje como DELETED en la proyeccion.
func (s *RatingService) HandleMessageDeleted(ctx context.Context, evt *schema.IncomingEvent, p *schema.MessageDeletedPayload) error {
	deletedAt := p.DeletedAt
	if deletedAt.IsZero() {
		deletedAt = evt.OccurredAt
	}
	if deletedAt.IsZero() {
		deletedAt = time.Now().UTC()
	}
	if err := s.repo.MarkDeleted(ctx, p.MessageID, p.AuthorID, deletedAt); err != nil {
		return err
	}
	slog.Info("Message projection deleted", "messageId", p.MessageID, "eventId", evt.EventID)
	return nil
}
