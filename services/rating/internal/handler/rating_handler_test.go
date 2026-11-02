package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"rating/internal/handler"
	"rating/internal/schema"
	"rating/internal/service"
	"rating/internal/testutil"
)

type pinger struct{ err error }

func (p pinger) Ping(context.Context) error { return p.err }

type brokerStatus bool

func (b brokerStatus) IsHealthy() bool { return bool(b) }

type env struct {
	mux     *http.ServeMux
	repo    *testutil.MemoryRepo
	pub     *testutil.RecordingPublisher
	author  uuid.UUID
	rater   uuid.UUID
	message uuid.UUID
}

func newEnv(t *testing.T, votesPerMinute, batchPerMinute int) *env {
	t.Helper()
	e := &env{
		repo:    testutil.NewMemoryRepo(),
		pub:     &testutil.RecordingPublisher{},
		author:  uuid.New(),
		rater:   uuid.New(),
		message: uuid.New(),
	}
	svc := service.NewRatingService(e.repo, e.pub)
	if err := e.repo.UpsertPublished(context.Background(), e.message, e.author, time.Now()); err != nil {
		t.Fatal(err)
	}
	h := handler.NewRatingHandler(svc, pinger{}, brokerStatus(true),
		handler.NewRateLimiter(votesPerMinute, time.Minute),
		handler.NewRateLimiter(batchPerMinute, time.Minute))
	e.mux = http.NewServeMux()
	h.Routes(e.mux)
	return e
}

func (e *env) do(method, path, user, body string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	if user != "" {
		req.Header.Set("X-User-ID", user)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, req)
	return rec
}

func decodeSummary(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &m); err != nil {
		t.Fatalf("invalid JSON %q: %v", rec.Body.String(), err)
	}
	return m
}

func expectError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d (body %s)", rec.Code, status, rec.Body.String())
	}
	var e schema.ErrorResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &e); err != nil || e.Error != code {
		t.Fatalf("error = %q (%v), want %q", e.Error, err, code)
	}
}

func TestRateResponseShape(t *testing.T) {
	e := newEnv(t, 30, 100)
	path := "/ratings/messages/" + e.message.String()

	rec := e.do(http.MethodPut, path, e.rater.String(), `{"value":"LIKE"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body %s", rec.Code, rec.Body.String())
	}
	m := decodeSummary(t, rec)
	// Sin envoltorio { success, data }: el resumen va directo.
	if _, wrapped := m["data"]; wrapped {
		t.Fatal("response must not be wrapped")
	}
	if m["messageId"] != e.message.String() || m["likes"] != 1.0 || m["dislikes"] != 0.0 ||
		m["score"] != 1.0 || m["myRating"] != "LIKE" {
		t.Fatalf("unexpected body %v", m)
	}

	rec = e.do(http.MethodDelete, path, e.rater.String(), "")
	m = decodeSummary(t, rec)
	if rec.Code != http.StatusOK || m["likes"] != 0.0 {
		t.Fatalf("delete: %d %v", rec.Code, m)
	}
	if v, present := m["myRating"]; !present || v != nil {
		t.Fatalf("myRating must be null after delete, got %v (present=%v)", v, present)
	}
}

func TestGetIncludesMyRating(t *testing.T) {
	e := newEnv(t, 30, 100)
	path := "/ratings/messages/" + e.message.String()
	e.do(http.MethodPut, path, e.rater.String(), `{"value":"DISLIKE"}`)

	m := decodeSummary(t, e.do(http.MethodGet, path, e.rater.String(), ""))
	if m["myRating"] != "DISLIKE" || m["score"] != -1.0 {
		t.Fatalf("rater view: %v", m)
	}
	m = decodeSummary(t, e.do(http.MethodGet, path, uuid.NewString(), ""))
	if m["myRating"] != nil || m["dislikes"] != 1.0 {
		t.Fatalf("other user view: %v", m)
	}

	expectError(t, e.do(http.MethodGet, "/ratings/messages/"+uuid.NewString(), e.rater.String(), ""),
		http.StatusNotFound, "message_not_found")
}

func TestErrors(t *testing.T) {
	e := newEnv(t, 30, 100)
	path := "/ratings/messages/" + e.message.String()

	expectError(t, e.do(http.MethodPut, path, "", `{"value":"LIKE"}`), http.StatusUnauthorized, "unauthorized")
	expectError(t, e.do(http.MethodPut, path, "not-a-uuid", `{"value":"LIKE"}`), http.StatusUnauthorized, "unauthorized")
	expectError(t, e.do(http.MethodPut, "/ratings/messages/abc", e.rater.String(), `{"value":"LIKE"}`),
		http.StatusBadRequest, "invalid_message_id")
	expectError(t, e.do(http.MethodPut, path, e.rater.String(), `{"value":"LOVE"}`),
		http.StatusUnprocessableEntity, "invalid_rating_value")
	expectError(t, e.do(http.MethodPut, path, e.rater.String(), `not json`),
		http.StatusUnprocessableEntity, "invalid_rating_value")
	expectError(t, e.do(http.MethodPut, path, e.author.String(), `{"value":"LIKE"}`),
		http.StatusForbidden, "self_rating_forbidden")
	expectError(t, e.do(http.MethodPut, "/ratings/messages/"+uuid.NewString(), e.rater.String(), `{"value":"LIKE"}`),
		http.StatusConflict, "message_not_ready")

	_ = e.repo.MarkDeleted(context.Background(), e.message, e.author, time.Now())
	expectError(t, e.do(http.MethodPut, path, e.rater.String(), `{"value":"LIKE"}`),
		http.StatusConflict, "message_not_rateable")

	e.repo.Err = errors.New("db down")
	rec := e.do(http.MethodGet, path, e.rater.String(), "")
	expectError(t, rec, http.StatusInternalServerError, "internal_error")
	if strings.Contains(rec.Body.String(), "db down") {
		t.Fatal("internal error details must not leak")
	}
}

func TestBatch(t *testing.T) {
	e := newEnv(t, 30, 100)
	e.do(http.MethodPut, "/ratings/messages/"+e.message.String(), e.rater.String(), `{"value":"LIKE"}`)

	other := uuid.NewString()
	rec := e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(),
		fmt.Sprintf(`{"messageIds":["%s","%s"]}`, e.message, other))
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body.String())
	}
	var list []schema.RatingSummaryResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &list); err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].Likes != 1 || *list[0].MyRating != "LIKE" ||
		list[1].MessageID.String() != other || list[1].MyRating != nil {
		t.Fatalf("unexpected batch %+v", list)
	}

	ids := make([]string, 101)
	for i := range ids {
		ids[i] = `"` + uuid.NewString() + `"`
	}
	expectError(t, e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(),
		`{"messageIds":[`+strings.Join(ids, ",")+`]}`), http.StatusBadRequest, "batch_too_large")

	expectError(t, e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(),
		`{"messageIds":["nope"]}`), http.StatusBadRequest, "invalid_message_id")

	// Exactamente 100 es valido.
	rec = e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(),
		`{"messageIds":[`+strings.Join(ids[:100], ",")+`]}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("batch of 100: status %d", rec.Code)
	}
}

func TestRateLimit(t *testing.T) {
	e := newEnv(t, 3, 2)
	path := "/ratings/messages/" + e.message.String()

	for i := range 3 {
		if rec := e.do(http.MethodPut, path, e.rater.String(), `{"value":"LIKE"}`); rec.Code != http.StatusOK {
			t.Fatalf("vote %d: status %d", i, rec.Code)
		}
	}
	rec := e.do(http.MethodDelete, path, e.rater.String(), "")
	expectError(t, rec, http.StatusTooManyRequests, "rate_limited")
	if rec.Header().Get("Retry-After") == "" {
		t.Fatal("missing Retry-After")
	}
	// El limite es por usuario.
	if rec := e.do(http.MethodPut, path, uuid.NewString(), `{"value":"LIKE"}`); rec.Code != http.StatusOK {
		t.Fatalf("other user should not be limited: %d", rec.Code)
	}
	// Las lecturas individuales no consumen cupo de votos.
	if rec := e.do(http.MethodGet, path, e.rater.String(), ""); rec.Code != http.StatusOK {
		t.Fatalf("GET should not be limited: %d", rec.Code)
	}

	for range 2 {
		e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(), `{"messageIds":[]}`)
	}
	expectError(t, e.do(http.MethodPost, "/ratings/messages/batch", e.rater.String(), `{"messageIds":[]}`),
		http.StatusTooManyRequests, "rate_limited")
}

func TestHealth(t *testing.T) {
	svc := service.NewRatingService(testutil.NewMemoryRepo(), nil)
	cases := []struct {
		name       string
		db         error
		broker     bool
		wantCode   int
		wantStatus string
	}{
		{"all up", nil, true, 200, "ok"},
		{"broker down", nil, false, 200, "degraded"},
		{"db down", errors.New("x"), true, 503, "down"},
	}
	for _, tc := range cases {
		h := handler.NewRatingHandler(svc, pinger{tc.db}, brokerStatus(tc.broker), nil, nil)
		rec := httptest.NewRecorder()
		h.Health(rec, httptest.NewRequest(http.MethodGet, "/health", nil))
		var resp schema.HealthResponse
		_ = json.Unmarshal(rec.Body.Bytes(), &resp)
		if rec.Code != tc.wantCode || resp.Status != tc.wantStatus {
			t.Errorf("%s: %d %+v", tc.name, rec.Code, resp)
		}
	}
}
