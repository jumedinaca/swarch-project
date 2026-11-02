// Package testutil contiene dobles de prueba compartidos por los tests de
// service y handler. No se usa en el binario.
package testutil

import (
	"context"
	"sync"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
)

type voteKey struct{ message, user uuid.UUID }

type storedVote struct {
	id    uuid.UUID
	value domain.Value
}

// MemoryRepo implementa repository.RatingRepository en memoria con la misma
// semantica que la version de Postgres.
type MemoryRepo struct {
	mu          sync.Mutex
	projections map[uuid.UUID]*domain.MessageProjection
	votes       map[voteKey]storedVote
	likes       map[uuid.UUID]int
	dislikes    map[uuid.UUID]int
	Err         error // si no es nil, todas las operaciones fallan con el
}

func NewMemoryRepo() *MemoryRepo {
	return &MemoryRepo{
		projections: map[uuid.UUID]*domain.MessageProjection{},
		votes:       map[voteKey]storedVote{},
		likes:       map[uuid.UUID]int{},
		dislikes:    map[uuid.UUID]int{},
	}
}

func (m *MemoryRepo) SetVote(_ context.Context, messageID, raterID uuid.UUID, value domain.Value) (*domain.VoteChange, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return nil, m.Err
	}

	proj := m.projections[messageID]
	if err := domain.CheckRateable(proj, raterID); err != nil {
		return nil, err
	}

	k := voteKey{messageID, raterID}
	prev := m.votes[k]
	change := &domain.VoteChange{
		RatingID:  prev.id,
		MessageID: messageID,
		AuthorID:  proj.AuthorID,
		RaterID:   raterID,
		Previous:  prev.value,
		Value:     value,
		Likes:     m.likes[messageID],
		Dislikes:  m.dislikes[messageID],
	}
	if prev.value == value {
		return change, nil
	}

	switch {
	case value == domain.None:
		delete(m.votes, k)
	case prev.value == domain.None:
		change.RatingID = uuid.New()
		m.votes[k] = storedVote{id: change.RatingID, value: value}
	default:
		m.votes[k] = storedVote{id: prev.id, value: value}
	}
	change.Likes, change.Dislikes = domain.ApplyVote(change.Likes, change.Dislikes, prev.value, value)
	m.likes[messageID], m.dislikes[messageID] = change.Likes, change.Dislikes
	change.ChangedAt = time.Now().UTC()
	change.Changed = true
	return change, nil
}

func (m *MemoryRepo) GetProjection(_ context.Context, messageID uuid.UUID) (*domain.MessageProjection, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return nil, m.Err
	}
	if p, ok := m.projections[messageID]; ok {
		cp := *p
		return &cp, nil
	}
	return nil, nil
}

func (m *MemoryRepo) GetSummaries(_ context.Context, ids []uuid.UUID, userID uuid.UUID) ([]domain.Summary, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return nil, m.Err
	}
	out := make([]domain.Summary, 0, len(ids))
	for _, id := range ids {
		out = append(out, domain.Summary{
			MessageID: id,
			Likes:     m.likes[id],
			Dislikes:  m.dislikes[id],
			MyRating:  m.votes[voteKey{id, userID}].value,
		})
	}
	return out, nil
}

func (m *MemoryRepo) UpsertPublished(_ context.Context, messageID, authorID uuid.UUID, publishedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return m.Err
	}
	status := domain.StatusPublished
	if p, ok := m.projections[messageID]; ok && p.Status == domain.StatusDeleted {
		status = domain.StatusDeleted
	}
	m.projections[messageID] = &domain.MessageProjection{
		MessageID: messageID, AuthorID: authorID, Status: status, PublishedAt: publishedAt,
	}
	return nil
}

func (m *MemoryRepo) MarkDeleted(_ context.Context, messageID, authorID uuid.UUID, deletedAt time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.Err != nil {
		return m.Err
	}
	if p, ok := m.projections[messageID]; ok {
		p.Status = domain.StatusDeleted
		return nil
	}
	m.projections[messageID] = &domain.MessageProjection{
		MessageID: messageID, AuthorID: authorID, Status: domain.StatusDeleted, PublishedAt: deletedAt,
	}
	return nil
}

// SetStatus fuerza el estado de un mensaje (p. ej. BLOCKED) en las pruebas.
func (m *MemoryRepo) SetStatus(messageID uuid.UUID, status domain.MessageStatus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if p, ok := m.projections[messageID]; ok {
		p.Status = status
	}
}

// RecordingPublisher guarda los cambios publicados; con Err simula broker caido.
type RecordingPublisher struct {
	mu      sync.Mutex
	Changes []domain.VoteChange
	Err     error
}

func (p *RecordingPublisher) PublishRatingChanged(_ context.Context, change *domain.VoteChange, _ string) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.Err != nil {
		return p.Err
	}
	p.Changes = append(p.Changes, *change)
	return nil
}

func (p *RecordingPublisher) Count() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.Changes)
}
