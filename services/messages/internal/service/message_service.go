package service

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/google/uuid"

	"messages/internal/domain"
	"messages/internal/repository"
	"messages/internal/schema"
)

type EventPublisher interface {
	PublishMessageSubmitted(ctx context.Context, message *domain.Message, correlationID uuid.UUID) error
	PublishMessagePublished(ctx context.Context, message *domain.Message, moderationDecision string, correlationID uuid.UUID) error
	PublishMessageDeleted(ctx context.Context, message *domain.Message, correlationID uuid.UUID) error
}

type MessageService struct {
	repository           repository.MessageRepository
	publisher            EventPublisher
	moderationTimeout    time.Duration
	pendingSweepInterval time.Duration
	failOpen             bool
	failClosed           bool
}

func NewMessageService(
	repository repository.MessageRepository,
	publisher EventPublisher,
	moderationTimeout time.Duration,
	pendingSweepInterval time.Duration,
	failOpen bool,
	failClosed bool,
) *MessageService {
	return &MessageService{
		repository:           repository,
		publisher:            publisher,
		moderationTimeout:    moderationTimeout,
		pendingSweepInterval: pendingSweepInterval,
		failOpen:             failOpen,
		failClosed:           failClosed,
	}
}

func (s *MessageService) CreateMessage(
	ctx context.Context,
	message *domain.Message,
) (*domain.Message, error) {

	if strings.TrimSpace(message.Content) == "" {
		return nil, fmt.Errorf("content cannot be empty")
	}

	created, err := s.repository.Create(ctx, message)
	if err != nil {
		return nil, err
	}

	// Sin outbox en P2: se publica después del commit y un fallo del broker
	// solo se registra; el barrido de pendientes aplicará la política.
	if s.publisher != nil {
		if err := s.publisher.PublishMessageSubmitted(ctx, created, uuid.New()); err != nil {
			slog.Error("Failed to publish message.submitted.v1",
				"error", err,
				"messageId", created.ID,
				"status", created.Status,
			)
		}
	}

	return created, nil
}

func (s *MessageService) UpdateMessage(
	ctx context.Context,
	messageID uuid.UUID,
	userID uuid.UUID,
	message *domain.Message,
) (*domain.Message, error) {

	if strings.TrimSpace(message.Content) == "" {
		return nil, fmt.Errorf("content cannot be empty")
	}

	existing, err := s.repository.GetByID(ctx, messageID)
	if err != nil {
		return nil, err
	}

	if existing.SenderID != userID {
		return nil, fmt.Errorf("message not found or user is not the owner")
	}

	return s.repository.Update(ctx, messageID, message)
}

func (s *MessageService) DeleteMessage(
	ctx context.Context,
	messageID uuid.UUID,
	userID uuid.UUID,
) error {

	existing, err := s.repository.GetByID(ctx, messageID)
	if err != nil {
		return err
	}

	if existing.SenderID != userID {
		return fmt.Errorf("message not found or user is not the owner")
	}

	if existing.Status == domain.StatusDeleted {
		return nil
	}

	deleted, err := s.repository.Delete(ctx, messageID)
	if err != nil {
		return err
	}

	if s.publisher != nil {
		if err := s.publisher.PublishMessageDeleted(ctx, deleted, uuid.New()); err != nil {
			slog.Error("Failed to publish message.deleted.v1",
				"error", err,
				"messageId", deleted.ID,
			)
		}
	}

	return nil
}

func (s *MessageService) GetMessageById(
	ctx context.Context,
	messageID uuid.UUID,
	userID uuid.UUID,
) (*domain.Message, error) {

	message, err := s.repository.GetByID(ctx, messageID)
	if err != nil {
		return nil, err
	}

	if message.SenderID != userID {
		return nil, fmt.Errorf("message not found or user is not the owner")
	}

	return message, nil
}

func (s *MessageService) GetNearby(
	ctx context.Context,
	latitude float64,
	longitude float64,
	radius float64,
) ([]*domain.Message, error) {

	if latitude < -90 || latitude > 90 {
		return nil, fmt.Errorf("invalid latitude")
	}

	if longitude < -180 || longitude > 180 {
		return nil, fmt.Errorf("invalid longitude")
	}

	if radius <= 0 {
		return nil, fmt.Errorf("radius must be greater than zero")
	}

	return s.repository.GetNearby(
		ctx,
		latitude,
		longitude,
		radius,
	)
}

// HandleModerationCompleted aplica la decisión de moderación solo si la
// versión coincide y el mensaje sigue PENDING (idempotencia por
// messageId + messageVersion).
func (s *MessageService) HandleModerationCompleted(
	ctx context.Context,
	event *schema.ModerationCompletedEvent,
) error {
	decision := strings.ToUpper(strings.TrimSpace(event.Payload.Decision))

	var status domain.MessageStatus
	var moderationStatus domain.ModerationStatus

	switch decision {
	case string(domain.ModerationAllow):
		status = domain.StatusPublished
		moderationStatus = domain.ModerationAllow
	case string(domain.ModerationWarn):
		status = domain.StatusPublished
		moderationStatus = domain.ModerationWarn
	case string(domain.ModerationBlock):
		status = domain.StatusBlocked
		moderationStatus = domain.ModerationBlock
	case string(domain.ModerationReview):
		// REVIEW deja el mensaje pendiente para revisión humana.
		slog.Info("Moderation requested review; message remains pending",
			"messageId", event.Payload.MessageId)
		return nil
	case string(domain.ModerationDegraded):
		status = domain.StatusPublished
		moderationStatus = domain.ModerationDegraded
	default:
		slog.Warn("Unknown moderation decision; ignoring",
			"messageId", event.Payload.MessageId,
			"decision", decision,
		)
		return nil
	}

	if event.Payload.Degraded && status == domain.StatusPublished && moderationStatus != domain.ModerationWarn {
		moderationStatus = domain.ModerationDegraded
	}

	reason := strings.Join(event.Payload.Reasons, ",")

	updated, err := s.repository.ApplyModerationDecision(
		ctx,
		event.Payload.MessageId,
		event.Payload.MessageVersion,
		status,
		moderationStatus,
		reason,
	)
	if err != nil {
		return err
	}
	if updated == nil {
		slog.Info("Moderation decision ignored (stale version or message no longer pending)",
			"messageId", event.Payload.MessageId,
			"messageVersion", event.Payload.MessageVersion,
		)
		return nil
	}

	slog.Info("Moderation decision applied",
		"messageId", updated.ID,
		"status", updated.Status,
		"moderationStatus", moderationStatus,
	)

	if updated.Status == domain.StatusPublished {
		s.publishPublished(ctx, updated, string(moderationStatus), event.CorrelationId)
	}

	return nil
}

func (s *MessageService) HandleModerationFailed(
	ctx context.Context,
	event *schema.ModerationFailedEvent,
) error {
	return s.applyFailurePolicy(
		ctx,
		event.Payload.MessageId,
		event.Payload.MessageVersion,
		event.CorrelationId,
		event.Payload.Reason,
	)
}

// SweepStalePending busca mensajes PENDING más viejos que el timeout y aplica
// la política configurada. Usa la propia tabla messages; no hay outbox.
func (s *MessageService) SweepStalePending(ctx context.Context) {
	cutoff := time.Now().UTC().Add(-s.moderationTimeout)

	messages, err := s.repository.ListStalePending(ctx, cutoff)
	if err != nil {
		slog.Error("Failed to list stale pending messages", "error", err)
		return
	}

	for _, message := range messages {
		if err := s.applyFailurePolicy(
			ctx,
			message.ID,
			message.Version,
			uuid.New(),
			"MODERATION_TIMEOUT",
		); err != nil {
			slog.Error("Failed to apply moderation failure policy",
				"error", err,
				"messageId", message.ID,
			)
		}
	}
}

func (s *MessageService) applyFailurePolicy(
	ctx context.Context,
	messageID uuid.UUID,
	messageVersion int32,
	correlationID uuid.UUID,
	reason string,
) error {
	status := domain.StatusBlocked
	moderationStatus := domain.ModerationBlock
	decision := string(domain.ModerationBlock)

	if s.failOpen && !s.failClosed {
		status = domain.StatusPublished
		moderationStatus = domain.ModerationDegraded
		decision = string(domain.ModerationDegraded)
	}

	updated, err := s.repository.ApplyModerationDecision(
		ctx,
		messageID,
		messageVersion,
		status,
		moderationStatus,
		reason,
	)
	if err != nil {
		return err
	}
	if updated == nil {
		return nil
	}

	slog.Info("Moderation failure policy applied",
		"messageId", updated.ID,
		"status", updated.Status,
		"moderationStatus", moderationStatus,
	)

	if updated.Status == domain.StatusPublished {
		s.publishPublished(ctx, updated, decision, correlationID)
	}

	return nil
}

func (s *MessageService) publishPublished(
	ctx context.Context,
	message *domain.Message,
	decision string,
	correlationID uuid.UUID,
) {
	if s.publisher == nil {
		return
	}

	if err := s.publisher.PublishMessagePublished(ctx, message, decision, correlationID); err != nil {
		slog.Error("Failed to publish message.published.v1",
			"error", err,
			"messageId", message.ID,
		)
	}
}
