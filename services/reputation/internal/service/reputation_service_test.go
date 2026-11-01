package service_test

import (
	"context"
	"testing"
	"time"

	"github.com/google/uuid"

	"reputation/internal/domain"
	"reputation/internal/messaging"
	"reputation/internal/repository"
	"reputation/internal/schema"
	"reputation/internal/service"
)

type mockRepository struct {
	reputations map[uuid.UUID]*domain.UserReputation
	ledger      map[uuid.UUID][]domain.ReputationLedger
	dedupeKeys  map[string]bool
	applied     []domain.AppliedChange
}

func newMockRepository() *mockRepository {
	return &mockRepository{
		reputations: make(map[uuid.UUID]*domain.UserReputation),
		ledger:      make(map[uuid.UUID][]domain.ReputationLedger),
		dedupeKeys:  make(map[string]bool),
	}
}

func (m *mockRepository) GetUserReputation(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	if rep, ok := m.reputations[userID]; ok {
		return rep, nil
	}
	return nil, nil
}

func (m *mockRepository) GetLeaderboard(ctx context.Context, limit int, cursor string) ([]domain.UserReputation, string, error) {
	var list []domain.UserReputation
	for _, r := range m.reputations {
		list = append(list, *r)
	}
	return list, "", nil
}

func (m *mockRepository) GetHistory(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReputationLedger, string, error) {
	return m.ledger[userID], "", nil
}

func (m *mockRepository) HasLedgerDedupeKey(ctx context.Context, userID uuid.UUID, dedupeKey string) (bool, error) {
	key := userID.String() + ":" + dedupeKey
	return m.dedupeKeys[key], nil
}

func (m *mockRepository) ApplyReputationChangeTx(ctx context.Context, params repository.ApplyChangeParams) (*domain.AppliedChange, error) {
	key := params.UserID.String() + ":" + params.DedupeKey
	if m.dedupeKeys[key] {
		return nil, repository.ErrDuplicateEvent
	}
	m.dedupeKeys[key] = true

	rep, ok := m.reputations[params.UserID]
	if !ok {
		rep = &domain.UserReputation{
			UserID:    params.UserID,
			Score:     0,
			Level:     "Novato",
			UpdatedAt: time.Now().UTC(),
		}
		m.reputations[params.UserID] = rep
	}

	prevScore := rep.Score
	prevLevel := rep.Level

	newScore := domain.ClampScore(prevScore + params.Delta)
	appliedDelta := newScore - prevScore

	levelInfo := domain.LevelFor(newScore)
	newLevel := levelInfo.Level

	rep.Score = newScore
	rep.Level = newLevel
	rep.Version++
	rep.UpdatedAt = time.Now().UTC()

	if params.Reason == domain.ReasonLikeReceived && params.Delta > 0 {
		rep.LikesReceived++
	} else if params.Reason == domain.ReasonDislikeReceived && params.Delta < 0 {
		rep.DislikesReceived++
	} else if params.Reason == domain.ReasonMessageBlocked {
		rep.MessagesBlocked++
	} else if params.Reason == domain.ReasonMessageWarned {
		rep.MessagesWarned++
	}

	change := domain.AppliedChange{
		UserID:        params.UserID,
		PreviousScore: prevScore,
		Score:         newScore,
		Delta:         params.Delta,
		AppliedDelta:  appliedDelta,
		PreviousLevel: prevLevel,
		Level:         newLevel,
		LevelChanged:  prevLevel != newLevel,
		Reason:        params.Reason,
		SourceEventID: params.SourceEventID,
		OccurredAt:    params.OccurredAt,
		ScoreAfter:    newScore,
	}
	m.applied = append(m.applied, change)
	return &change, nil
}

func (m *mockRepository) RecomputeUserReputationTx(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	return m.GetUserReputation(ctx, userID)
}

type mockPublisher struct {
	published []domain.AppliedChange
}

func (m *mockPublisher) PublishReputationChanged(ctx context.Context, change *domain.AppliedChange, correlationID uuid.UUID) error {
	m.published = append(m.published, *change)
	return nil
}

var _ messaging.EventPublisher = (*mockPublisher)(nil)

func TestHandleRatingChanged(t *testing.T) {
	repo := newMockRepository()
	pub := &mockPublisher{}
	svc := service.NewReputationService(repo, pub)

	authorID := uuid.New()
	raterID := uuid.New()
	messageID := uuid.New()

	ctx := context.Background()

	// 1. Like received: delta = (1 - 0) * 2 = +2
	event1 := &schema.RatingChangedEvent{
		EventId:       uuid.New(),
		EventType:     "rating.changed.v1",
		Version:       1,
		CorrelationId: uuid.New(),
		Payload: schema.RatingChangedPayload{
			MessageId:       messageID,
			MessageAuthorId: authorID,
			RaterId:         raterID,
			PreviousValue:   0,
			Value:           1,
		},
	}

	err := svc.HandleRatingChanged(ctx, event1)
	if err != nil {
		t.Fatalf("HandleRatingChanged failed: %v", err)
	}

	rep, err := svc.GetUserReputation(ctx, authorID)
	if err != nil {
		t.Fatalf("GetUserReputation failed: %v", err)
	}
	if rep.Score != 2 {
		t.Errorf("Score = %d; want 2", rep.Score)
	}
	if rep.LikesReceived != 1 {
		t.Errorf("LikesReceived = %d; want 1", rep.LikesReceived)
	}
	if len(pub.published) != 1 {
		t.Fatalf("expected 1 published event, got %d", len(pub.published))
	}

	// 2. Duplicate rating event: should be ignored gracefully
	err = svc.HandleRatingChanged(ctx, event1)
	if err != nil {
		t.Fatalf("Duplicate event should not return error: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, authorID)
	if rep.Score != 2 {
		t.Errorf("Score changed on duplicate: %d; want 2", rep.Score)
	}

	// 3. Self rating should be ignored
	selfEvent := &schema.RatingChangedEvent{
		EventId:   uuid.New(),
		EventType: "rating.changed.v1",
		Payload: schema.RatingChangedPayload{
			MessageId:       messageID,
			MessageAuthorId: authorID,
			RaterId:         authorID, // same!
			PreviousValue:   0,
			Value:           1,
		},
	}
	err = svc.HandleRatingChanged(ctx, selfEvent)
	if err != nil {
		t.Fatalf("Self rating should not error: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, authorID)
	if rep.Score != 2 {
		t.Errorf("Score changed on self rating: %d; want 2", rep.Score)
	}

	// 4. Vote change like -> dislike: delta = (-1 - 1) * 2 = -4 -> score clamped to 0
	eventVoteChange := &schema.RatingChangedEvent{
		EventId:       uuid.New(),
		EventType:     "rating.changed.v1",
		CorrelationId: uuid.New(),
		Payload: schema.RatingChangedPayload{
			MessageId:       messageID,
			MessageAuthorId: authorID,
			RaterId:         raterID,
			PreviousValue:   1,
			Value:           -1,
		},
	}
	err = svc.HandleRatingChanged(ctx, eventVoteChange)
	if err != nil {
		t.Fatalf("Vote change failed: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, authorID)
	// 2 - 4 = -2, clamped to 0
	if rep.Score != 0 {
		t.Errorf("Score after clamp = %d; want 0", rep.Score)
	}
}

func TestHandleModerationCompleted(t *testing.T) {
	repo := newMockRepository()
	pub := &mockPublisher{}
	svc := service.NewReputationService(repo, pub)

	authorID := uuid.New()
	messageID := uuid.New()
	ctx := context.Background()

	// 1. ALLOW: delta +1
	allowEvent := &schema.ModerationCompletedEvent{
		EventId:   uuid.New(),
		EventType: "moderation.completed.v1",
		Payload: schema.ModerationCompletedPayload{
			MessageId: messageID,
			AuthorId:  authorID,
			Decision:  "ALLOW",
		},
	}
	err := svc.HandleModerationCompleted(ctx, allowEvent)
	if err != nil {
		t.Fatalf("ALLOW failed: %v", err)
	}

	rep, _ := svc.GetUserReputation(ctx, authorID)
	if rep.Score != 1 {
		t.Errorf("Score after ALLOW = %d; want 1", rep.Score)
	}

	// 2. Duplicate ALLOW should be ignored
	err = svc.HandleModerationCompleted(ctx, allowEvent)
	if err != nil {
		t.Fatalf("Duplicate ALLOW returned error: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, authorID)
	if rep.Score != 1 {
		t.Errorf("Score changed on duplicate: %d; want 1", rep.Score)
	}

	// 3. WARN on a new message: delta -3 (from 1 to 0 clamped)
	messageID2 := uuid.New()
	warnEvent := &schema.ModerationCompletedEvent{
		EventId:   uuid.New(),
		EventType: "moderation.completed.v1",
		Payload: schema.ModerationCompletedPayload{
			MessageId: messageID2,
			AuthorId:  authorID,
			Decision:  "WARN",
		},
	}
	err = svc.HandleModerationCompleted(ctx, warnEvent)
	if err != nil {
		t.Fatalf("WARN failed: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, authorID)
	if rep.Score != 0 {
		t.Errorf("Score after WARN = %d; want 0", rep.Score)
	}
	if rep.MessagesWarned != 1 {
		t.Errorf("MessagesWarned = %d; want 1", rep.MessagesWarned)
	}

	// 4. Transition from WARN to BLOCK: messageID2 becomes BLOCK
	// Should apply delta -7 (because WARN was already -3)
	blockEvent := &schema.ModerationCompletedEvent{
		EventId:   uuid.New(),
		EventType: "moderation.completed.v1",
		Payload: schema.ModerationCompletedPayload{
			MessageId: messageID2,
			AuthorId:  authorID,
			Decision:  "BLOCK",
		},
	}
	err = svc.HandleModerationCompleted(ctx, blockEvent)
	if err != nil {
		t.Fatalf("BLOCK after WARN failed: %v", err)
	}
	lastApplied := repo.applied[len(repo.applied)-1]
	if lastApplied.Delta != -7 {
		t.Errorf("Applied delta on WARN->BLOCK = %d; want -7", lastApplied.Delta)
	}
	if lastApplied.Reason != domain.ReasonMessageBlocked {
		t.Errorf("Reason = %s; want MESSAGE_BLOCKED", lastApplied.Reason)
	}
}

func TestGetUserReputationDefault(t *testing.T) {
	repo := newMockRepository()
	svc := service.NewReputationService(repo, nil)

	unseenUser := uuid.New()
	rep, err := svc.GetUserReputation(context.Background(), unseenUser)
	if err != nil {
		t.Fatalf("GetUserReputation failed: %v", err)
	}
	if rep.Score != 0 {
		t.Errorf("Default score = %d; want 0", rep.Score)
	}
	if rep.Level != "Novato" {
		t.Errorf("Default level = %s; want Novato", rep.Level)
	}
}
