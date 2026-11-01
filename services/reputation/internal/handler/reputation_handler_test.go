package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"

	"reputation/internal/domain"
	"reputation/internal/handler"
	"reputation/internal/repository"
	"reputation/internal/schema"
	"reputation/internal/service"
)

type mockRepo struct {
	rep *domain.UserReputation
}

func (m *mockRepo) GetUserReputation(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	if m.rep != nil && m.rep.UserID == userID {
		return m.rep, nil
	}
	return nil, nil
}

func (m *mockRepo) GetLeaderboard(ctx context.Context, limit int, cursor string) ([]domain.UserReputation, string, error) {
	if m.rep != nil {
		return []domain.UserReputation{*m.rep}, "", nil
	}
	return []domain.UserReputation{}, "", nil
}

func (m *mockRepo) GetHistory(ctx context.Context, userID uuid.UUID, limit int, cursor string) ([]domain.ReputationLedger, string, error) {
	return []domain.ReputationLedger{}, "", nil
}

func (m *mockRepo) HasLedgerDedupeKey(ctx context.Context, userID uuid.UUID, dedupeKey string) (bool, error) {
	return false, nil
}

func (m *mockRepo) ApplyReputationChangeTx(ctx context.Context, params repository.ApplyChangeParams) (*domain.AppliedChange, error) {
	return nil, nil
}

func (m *mockRepo) RecomputeUserReputationTx(ctx context.Context, userID uuid.UUID) (*domain.UserReputation, error) {
	return m.GetUserReputation(ctx, userID)
}

type mockDBPinger struct {
	err error
}

func (m *mockDBPinger) Ping(ctx context.Context) error {
	return m.err
}

func TestGetMe(t *testing.T) {
	userID := uuid.New()
	repo := &mockRepo{
		rep: &domain.UserReputation{
			UserID:        userID,
			Score:         120,
			Level:         "Miembro",
			LikesReceived: 60,
			UpdatedAt:     time.Now().UTC(),
		},
	}
	svc := service.NewReputationService(repo, nil)
	h := handler.NewReputationHandler(svc, &mockDBPinger{}, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /reputation/me", h.GetMe)

	// 1. Missing header -> 401
	req := httptest.NewRequest("GET", "/reputation/me", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Errorf("GetMe() status = %d; want %d", w.Code, http.StatusUnauthorized)
	}

	// 2. Valid header -> 200
	req = httptest.NewRequest("GET", "/reputation/me", nil)
	req.Header.Set("X-User-ID", userID.String())
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("GetMe() status = %d; want %d", w.Code, http.StatusOK)
	}

	var resp schema.UserReputationResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp.Score != 120 {
		t.Errorf("resp.Score = %d; want 120", resp.Score)
	}
	if resp.Level != "Miembro" {
		t.Errorf("resp.Level = %s; want Miembro", resp.Level)
	}
}

func TestGetByUserID_NotFoundReturnsDefault(t *testing.T) {
	repo := &mockRepo{}
	svc := service.NewReputationService(repo, nil)
	h := handler.NewReputationHandler(svc, &mockDBPinger{}, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /reputation/{userId}", h.GetByUserID)

	userID := uuid.New()
	req := httptest.NewRequest("GET", "/reputation/"+userID.String(), nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Rule: GET de usuario sin fila devuelve score: 0, level: 'Novato' (no 404).
	if w.Code != http.StatusOK {
		t.Fatalf("GetByUserID status = %d; want %d", w.Code, http.StatusOK)
	}

	var resp schema.UserReputationResponse
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("Failed to decode response: %v", err)
	}
	if resp.Score != 0 {
		t.Errorf("resp.Score = %d; want 0", resp.Score)
	}
	if resp.Level != "Novato" {
		t.Errorf("resp.Level = %s; want Novato", resp.Level)
	}
}

func TestHealth(t *testing.T) {
	svc := service.NewReputationService(&mockRepo{}, nil)
	h := handler.NewReputationHandler(svc, &mockDBPinger{}, nil)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", h.Health)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, req)

	// Broker is nil, so broker is disconnected -> degraded (503)
	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("Health status = %d; want %d", w.Code, http.StatusServiceUnavailable)
	}
}
