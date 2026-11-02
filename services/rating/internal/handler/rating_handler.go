package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
	"rating/internal/schema"
	"rating/internal/service"
)

const maxBodyBytes = 64 << 10

type DatabasePinger interface {
	Ping(ctx context.Context) error
}

type BrokerStatus interface {
	IsHealthy() bool
}

type RatingHandler struct {
	service      *service.RatingService
	db           DatabasePinger
	broker       BrokerStatus
	voteLimiter  *RateLimiter
	batchLimiter *RateLimiter
}

func NewRatingHandler(
	svc *service.RatingService,
	db DatabasePinger,
	broker BrokerStatus,
	voteLimiter, batchLimiter *RateLimiter,
) *RatingHandler {
	return &RatingHandler{
		service:      svc,
		db:           db,
		broker:       broker,
		voteLimiter:  voteLimiter,
		batchLimiter: batchLimiter,
	}
}

// Routes registra los endpoints del servicio.
func (h *RatingHandler) Routes(mux *http.ServeMux) {
	mux.HandleFunc("PUT /ratings/messages/{messageId}", h.Rate)
	mux.HandleFunc("DELETE /ratings/messages/{messageId}", h.Remove)
	mux.HandleFunc("GET /ratings/messages/{messageId}", h.Get)
	mux.HandleFunc("POST /ratings/messages/batch", h.Batch)
	mux.HandleFunc("GET /health", h.Health)
}

// Rate maneja PUT /ratings/messages/{messageId} con body {"value":"LIKE"|"DISLIKE"}.
func (h *RatingHandler) Rate(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID, ok := pathMessageID(w, r)
	if !ok {
		return
	}
	if !h.allow(w, h.voteLimiter, userID) {
		return
	}

	var req schema.RateRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_rating_value", `Body must be {"value":"LIKE"} or {"value":"DISLIKE"}`)
		return
	}
	value, err := domain.ParseValue(req.Value)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid_rating_value", `value must be "LIKE" or "DISLIKE"`)
		return
	}

	summary, err := h.service.Rate(r.Context(), userID, messageID, value, correlationID(r))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, schema.ToSummaryResponse(summary))
}

// Remove maneja DELETE /ratings/messages/{messageId}.
func (h *RatingHandler) Remove(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID, ok := pathMessageID(w, r)
	if !ok {
		return
	}
	if !h.allow(w, h.voteLimiter, userID) {
		return
	}

	summary, err := h.service.Remove(r.Context(), userID, messageID, correlationID(r))
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, schema.ToSummaryResponse(summary))
}

// Get maneja GET /ratings/messages/{messageId}.
func (h *RatingHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	messageID, ok := pathMessageID(w, r)
	if !ok {
		return
	}

	summary, err := h.service.Get(r.Context(), userID, messageID)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, schema.ToSummaryResponse(summary))
}

// Batch maneja POST /ratings/messages/batch con body {"messageIds":[...]}.
func (h *RatingHandler) Batch(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	if !h.allow(w, h.batchLimiter, userID) {
		return
	}

	var req schema.BatchRequest
	r.Body = http.MaxBytesReader(w, r.Body, maxBodyBytes)
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid_request", `Body must be {"messageIds":["..."]}`)
		return
	}
	if len(req.MessageIDs) > schema.MaxBatchSize {
		writeError(w, http.StatusBadRequest, "batch_too_large", "At most 100 messageIds per request")
		return
	}

	ids := make([]uuid.UUID, 0, len(req.MessageIDs))
	for _, raw := range req.MessageIDs {
		id, err := uuid.Parse(raw)
		if err != nil {
			writeError(w, http.StatusBadRequest, "invalid_message_id", "Invalid messageId: "+raw)
			return
		}
		ids = append(ids, id)
	}

	summaries, err := h.service.Batch(r.Context(), userID, ids)
	if err != nil {
		writeDomainError(w, err)
		return
	}
	out := make([]schema.RatingSummaryResponse, 0, len(summaries))
	for _, s := range summaries {
		out = append(out, schema.ToSummaryResponse(s))
	}
	writeJSON(w, http.StatusOK, out)
}

// Health maneja GET /health. Responde 503 solo si la base de datos no esta
// disponible: sin broker el servicio sigue aceptando votos.
func (h *RatingHandler) Health(w http.ResponseWriter, r *http.Request) {
	resp := schema.HealthResponse{Status: "ok", Database: "connected", Broker: "connected"}
	code := http.StatusOK

	ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
	defer cancel()
	if h.db == nil || h.db.Ping(ctx) != nil {
		resp.Database = "disconnected"
		resp.Status = "down"
		code = http.StatusServiceUnavailable
	}
	if h.broker == nil || !h.broker.IsHealthy() {
		resp.Broker = "disconnected"
		if resp.Status == "ok" {
			resp.Status = "degraded"
		}
	}
	writeJSON(w, code, resp)
}

func (h *RatingHandler) allow(w http.ResponseWriter, l *RateLimiter, userID uuid.UUID) bool {
	if l == nil {
		return true
	}
	ok, retryAfter := l.Allow(userID.String())
	if !ok {
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
		writeError(w, http.StatusTooManyRequests, "rate_limited", "Too many requests, try again later")
	}
	return ok
}

// requireUser lee X-User-ID, que agrega el gateway tras validar el JWT.
func requireUser(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	raw := r.Header.Get("X-User-ID")
	if raw == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Missing X-User-ID header")
		return uuid.Nil, false
	}
	id, err := uuid.Parse(raw)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Invalid X-User-ID header")
		return uuid.Nil, false
	}
	return id, true
}

func pathMessageID(w http.ResponseWriter, r *http.Request) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue("messageId"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_message_id", "messageId must be a UUID")
		return uuid.Nil, false
	}
	return id, true
}

// correlationID toma X-Correlation-ID solo si es un UUID: los consumidores
// (p. ej. reputation) decodifican correlationId como UUID. Si no, el
// publicador usa el eventId.
func correlationID(r *http.Request) string {
	id, err := uuid.Parse(r.Header.Get("X-Correlation-ID"))
	if err != nil {
		return ""
	}
	return id.String()
}

func writeDomainError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, domain.ErrMessageNotFound):
		writeError(w, http.StatusNotFound, "message_not_found", "Message not found")
	case errors.Is(err, domain.ErrMessageNotReady):
		writeError(w, http.StatusConflict, "message_not_ready", "Message is not available for rating yet")
	case errors.Is(err, domain.ErrMessageNotRateable):
		writeError(w, http.StatusConflict, "message_not_rateable", "Message is blocked or deleted")
	case errors.Is(err, domain.ErrSelfRating):
		writeError(w, http.StatusForbidden, "self_rating_forbidden", "You cannot rate your own message")
	case errors.Is(err, domain.ErrInvalidValue):
		writeError(w, http.StatusUnprocessableEntity, "invalid_rating_value", `value must be "LIKE" or "DISLIKE"`)
	default:
		slog.Error("Unexpected error", "error", err)
		writeError(w, http.StatusInternalServerError, "internal_error", "Internal server error")
	}
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, schema.ErrorResponse{Error: code, Message: message})
}
