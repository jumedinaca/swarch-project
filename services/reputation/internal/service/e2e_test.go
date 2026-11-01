package service_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"reputation/internal/handler"
	"reputation/internal/schema"
	"reputation/internal/service"
)

type mockPinger struct{}

func (m *mockPinger) Ping(ctx context.Context) error { return nil }

func TestEndToEndReputationFlow(t *testing.T) {
	ctx := context.Background()
	repo := newMockRepository()
	pub := &mockPublisher{}
	svc := service.NewReputationService(repo, pub)
	h := handler.NewReputationHandler(svc, &mockPinger{}, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /reputation/me", h.GetMe)
	mux.HandleFunc("GET /reputation/leaderboard", h.GetLeaderboard)
	mux.HandleFunc("GET /reputation/{userId}", h.GetByUserID)
	mux.HandleFunc("GET /reputation/{userId}/history", h.GetHistory)
	mux.HandleFunc("POST /reputation/{userId}/recompute", h.Recompute)

	userA := uuid.New()
	userB := uuid.New()
	message1 := uuid.New()
	message2 := uuid.New()

	// -------------------------------------------------------------
	// 1. New User Query: GET /reputation/me
	// -------------------------------------------------------------
	req := httptest.NewRequest("GET", "/reputation/me", nil)
	req.Header.Set("X-User-ID", userA.String())
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("Expected 200 OK for new user /me, got %d", w.Code)
	}

	var meResp schema.UserReputationResponse
	if err := json.NewDecoder(w.Body).Decode(&meResp); err != nil {
		t.Fatalf("Failed decoding /me response: %v", err)
	}
	if meResp.Score != 0 || meResp.Level != "Novato" || meResp.LevelIndex != 0 {
		t.Errorf("Unexpected initial state: %+v", meResp)
	}
	t.Logf("✓ Step 1: New user initial state verified: score=%d, level=%s", meResp.Score, meResp.Level)

	// -------------------------------------------------------------
	// 2. Rating Event: Like received (+2)
	// -------------------------------------------------------------
	likeEvent := &schema.RatingChangedEvent{
		EventId:       uuid.New(),
		EventType:     "rating.changed.v1",
		Version:       1,
		CorrelationId: uuid.New(),
		OccurredAt:    time.Now().UTC(),
		Payload: schema.RatingChangedPayload{
			MessageId:       message1,
			MessageAuthorId: userA,
			RaterId:         userB,
			PreviousValue:   0,
			Value:           1,
			Likes:           1,
			Dislikes:        0,
		},
	}

	if err := svc.HandleRatingChanged(ctx, likeEvent); err != nil {
		t.Fatalf("Failed handling rating event: %v", err)
	}

	// Verify via GET /reputation/{userId}
	req = httptest.NewRequest("GET", "/reputation/"+userA.String(), nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	var userResp schema.UserReputationResponse
	_ = json.NewDecoder(w.Body).Decode(&userResp)
	if userResp.Score != 2 || userResp.LikesReceived != 1 {
		t.Errorf("Score after like = %d, likes = %d; want score=2, likes=1", userResp.Score, userResp.LikesReceived)
	}
	t.Logf("✓ Step 2: Like event applied correctly: score=%d, likesReceived=%d", userResp.Score, userResp.LikesReceived)

	// -------------------------------------------------------------
	// 3. Moderation Event: ALLOW (+1)
	// -------------------------------------------------------------
	allowEvent := &schema.ModerationCompletedEvent{
		EventId:       uuid.New(),
		EventType:     "moderation.completed.v1",
		Version:       1,
		CorrelationId: uuid.New(),
		OccurredAt:    time.Now().UTC(),
		Payload: schema.ModerationCompletedPayload{
			MessageId: message1,
			AuthorId:  userA,
			Decision:  "ALLOW",
		},
	}
	if err := svc.HandleModerationCompleted(ctx, allowEvent); err != nil {
		t.Fatalf("Failed handling ALLOW event: %v", err)
	}

	rep, _ := svc.GetUserReputation(ctx, userA)
	if rep.Score != 3 {
		t.Errorf("Score after ALLOW = %d; want 3", rep.Score)
	}
	t.Logf("✓ Step 3: Moderation ALLOW applied: score=%d", rep.Score)

	// -------------------------------------------------------------
	// 4. Moderation WARN (-3) and transition to BLOCK (-7)
	// -------------------------------------------------------------
	warnEvent := &schema.ModerationCompletedEvent{
		EventId:       uuid.New(),
		EventType:     "moderation.completed.v1",
		Version:       1,
		CorrelationId: uuid.New(),
		OccurredAt:    time.Now().UTC(),
		Payload: schema.ModerationCompletedPayload{
			MessageId: message2,
			AuthorId:  userA,
			Decision:  "WARN",
		},
	}
	if err := svc.HandleModerationCompleted(ctx, warnEvent); err != nil {
		t.Fatalf("Failed handling WARN event: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, userA)
	if rep.Score != 0 || rep.MessagesWarned != 1 {
		t.Errorf("Score after WARN = %d (want 0 clamped), warned = %d (want 1)", rep.Score, rep.MessagesWarned)
	}

	// Message2 escalates from WARN to BLOCK: difference -7 applied
	blockEvent := &schema.ModerationCompletedEvent{
		EventId:       uuid.New(),
		EventType:     "moderation.completed.v1",
		Version:       1,
		CorrelationId: uuid.New(),
		OccurredAt:    time.Now().UTC(),
		Payload: schema.ModerationCompletedPayload{
			MessageId: message2,
			AuthorId:  userA,
			Decision:  "BLOCK",
		},
	}
	if err := svc.HandleModerationCompleted(ctx, blockEvent); err != nil {
		t.Fatalf("Failed handling BLOCK transition: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, userA)
	if rep.Score != 0 || rep.MessagesBlocked != 1 {
		t.Errorf("Score after BLOCK = %d, blocked = %d (want 1)", rep.Score, rep.MessagesBlocked)
	}
	t.Logf("✓ Step 4: WARN and transition to BLOCK verified: warned=%d, blocked=%d, score=%d (clamped)",
		rep.MessagesWarned, rep.MessagesBlocked, rep.Score)

	// -------------------------------------------------------------
	// 5. Idempotency test: duplicate events
	// -------------------------------------------------------------
	scoreBefore := rep.Score
	if err := svc.HandleRatingChanged(ctx, likeEvent); err != nil {
		t.Fatalf("Duplicate rating event should be ignored: %v", err)
	}
	if err := svc.HandleModerationCompleted(ctx, allowEvent); err != nil {
		t.Fatalf("Duplicate moderation event should be ignored: %v", err)
	}
	rep, _ = svc.GetUserReputation(ctx, userA)
	if rep.Score != scoreBefore {
		t.Errorf("Score changed on duplicate delivery! %d != %d", rep.Score, scoreBefore)
	}
	t.Logf("✓ Step 5: Idempotency verified: duplicate events safely ignored")

	// -------------------------------------------------------------
	// 6. Level Transition test: boost score to Miembro (50+)
	// -------------------------------------------------------------
	// Send 25 likes from distinct raters on distinct messages
	for i := 0; i < 25; i++ {
		evt := &schema.RatingChangedEvent{
			EventId:       uuid.New(),
			EventType:     "rating.changed.v1",
			Version:       1,
			CorrelationId: uuid.New(),
			OccurredAt:    time.Now().UTC(),
			Payload: schema.RatingChangedPayload{
				MessageId:       uuid.New(),
				MessageAuthorId: userA,
				RaterId:         uuid.New(),
				PreviousValue:   0,
				Value:           1,
			},
		}
		_ = svc.HandleRatingChanged(ctx, evt)
	}

	rep, _ = svc.GetUserReputation(ctx, userA)
	if rep.Score < 50 || rep.Level != "Miembro" {
		t.Errorf("Expected Miembro (score >= 50), got score=%d, level=%s", rep.Score, rep.Level)
	}
	t.Logf("✓ Step 6: Level transition verified: score=%d, level=%s", rep.Score, rep.Level)

	// -------------------------------------------------------------
	// 7. Leaderboard & Recompute
	// -------------------------------------------------------------
	req = httptest.NewRequest("GET", "/reputation/leaderboard", nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Leaderboard returned status %d", w.Code)
	}

	var leaderboard []schema.UserReputationResponse
	_ = json.NewDecoder(w.Body).Decode(&leaderboard)
	if len(leaderboard) == 0 {
		t.Errorf("Expected at least 1 entry in leaderboard")
	}
	t.Logf("✓ Step 7: Leaderboard returned %d users", len(leaderboard))

	// Recompute test
	req = httptest.NewRequest("POST", fmt.Sprintf("/reputation/%s/recompute", userA.String()), nil)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("Recompute returned status %d", w.Code)
	}
	var recomputeResp schema.UserReputationResponse
	_ = json.NewDecoder(w.Body).Decode(&recomputeResp)
	if recomputeResp.Score != rep.Score {
		t.Errorf("Recompute mismatch: %d != %d", recomputeResp.Score, rep.Score)
	}
	t.Logf("✓ Step 8: Recompute successfully verified: rebuilt score=%d", recomputeResp.Score)
}
