package handler

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"

	"messages/internal/domain"
	"messages/internal/service"
)

type fakeRepository struct {
	nearby                    []*domain.Message
	gotLat, gotLng, gotRadius float64
}

func (f *fakeRepository) Create(ctx context.Context, message *domain.Message) (*domain.Message, error) {
	return message, nil
}

func (f *fakeRepository) Delete(ctx context.Context, id uuid.UUID, senderID uuid.UUID) error {
	return nil
}

func (f *fakeRepository) GetByID(ctx context.Context, id uuid.UUID, senderID uuid.UUID) (*domain.Message, error) {
	return nil, nil
}

func (f *fakeRepository) GetNearby(ctx context.Context, latitude float64, longitude float64, radius float64) ([]*domain.Message, error) {
	f.gotLat, f.gotLng, f.gotRadius = latitude, longitude, radius
	return f.nearby, nil
}

func TestGetNearbyMessagesReadsQueryParameters(t *testing.T) {
	repo := &fakeRepository{nearby: []*domain.Message{}}
	h := NewMessageHandler(service.NewMessageService(repo))

	req := httptest.NewRequest(http.MethodGet, "/messages/nearby?lat=4.6371&lng=-74.0834&radius=500", nil)
	rec := httptest.NewRecorder()
	h.GetNearbyMessages(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := strings.TrimSpace(rec.Body.String()); got != "[]" {
		t.Errorf("body = %q, want []", got)
	}
	if repo.gotLat != 4.6371 || repo.gotLng != -74.0834 || repo.gotRadius != 500 {
		t.Errorf("repository got (%v, %v, %v), want (4.6371, -74.0834, 500)", repo.gotLat, repo.gotLng, repo.gotRadius)
	}
}

func TestGetNearbyMessagesRejectsMissingOrInvalidParameters(t *testing.T) {
	h := NewMessageHandler(service.NewMessageService(&fakeRepository{}))

	for _, query := range []string{
		"",
		"?lat=4.6&lng=-74.08",
		"?lat=abc&lng=-74.08&radius=500",
	} {
		req := httptest.NewRequest(http.MethodGet, "/messages/nearby"+query, nil)
		rec := httptest.NewRecorder()
		h.GetNearbyMessages(rec, req)

		if rec.Code != http.StatusBadRequest {
			t.Errorf("query %q: status = %d, want 400", query, rec.Code)
		}
	}
}

func TestGetNearbyMessagesValidatesRange(t *testing.T) {
	h := NewMessageHandler(service.NewMessageService(&fakeRepository{}))

	req := httptest.NewRequest(http.MethodGet, "/messages/nearby?lat=91&lng=0&radius=500", nil)
	rec := httptest.NewRecorder()
	h.GetNearbyMessages(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Errorf("status = %d, want 400", rec.Code)
	}
}
