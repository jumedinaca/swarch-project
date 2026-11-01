package handler

import (
	"context"
	"net/http"
	"strconv"

	"github.com/google/uuid"

	"reputation/internal/messaging"
	"reputation/internal/schema"
	"reputation/internal/service"
)

type DatabasePinger interface {
	Ping(ctx context.Context) error
}

type ReputationHandler struct {
	service  *service.ReputationService
	db       DatabasePinger
	rabbitmq *messaging.RabbitMQConnection
}

func NewReputationHandler(
	svc *service.ReputationService,
	db DatabasePinger,
	rabbitmq *messaging.RabbitMQConnection,
) *ReputationHandler {
	return &ReputationHandler{
		service:  svc,
		db:       db,
		rabbitmq: rabbitmq,
	}
}

// GetMe handles GET /reputation/me
func (h *ReputationHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userIDHeader := r.Header.Get("X-User-ID")
	if userIDHeader == "" {
		writeError(w, http.StatusUnauthorized, "unauthorized", "Missing X-User-ID header")
		return
	}

	userID, err := uuid.Parse(userIDHeader)
	if err != nil {
		writeError(w, http.StatusUnauthorized, "invalid_user_id", "Invalid X-User-ID header")
		return
	}

	rep, err := h.service.GetUserReputation(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, schema.ToUserReputationResponse(rep))
}

// GetByUserID handles GET /reputation/{userId}
func (h *ReputationHandler) GetByUserID(w http.ResponseWriter, r *http.Request) {
	userIdStr := r.PathValue("userId")
	if userIdStr == "" {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Missing userId path parameter")
		return
	}

	userID, err := uuid.Parse(userIdStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Invalid userId format")
		return
	}

	rep, err := h.service.GetUserReputation(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, schema.ToUserReputationResponse(rep))
}

// GetLeaderboard handles GET /reputation/leaderboard?limit=20&cursor=
func (h *ReputationHandler) GetLeaderboard(w http.ResponseWriter, r *http.Request) {
	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	cursor := r.URL.Query().Get("cursor")

	users, nextCursor, err := h.service.GetLeaderboard(r.Context(), limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	responses := make([]schema.UserReputationResponse, 0, len(users))
	for _, u := range users {
		responses = append(responses, schema.ToUserReputationResponse(&u))
	}

	if nextCursor != "" {
		w.Header().Set("X-Next-Cursor", nextCursor)
	}

	writeJSON(w, http.StatusOK, responses)
}

// GetHistory handles GET /reputation/{userId}/history?limit=20&cursor=
func (h *ReputationHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	userIdStr := r.PathValue("userId")
	if userIdStr == "" {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Missing userId path parameter")
		return
	}

	userID, err := uuid.Parse(userIdStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Invalid userId format")
		return
	}

	limitStr := r.URL.Query().Get("limit")
	limit := 20
	if limitStr != "" {
		if parsed, err := strconv.Atoi(limitStr); err == nil && parsed > 0 {
			limit = parsed
		}
	}
	cursor := r.URL.Query().Get("cursor")

	entries, nextCursor, err := h.service.GetHistory(r.Context(), userID, limit, cursor)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	responses := make([]schema.ReputationLedgerResponse, 0, len(entries))
	for i := range entries {
		responses = append(responses, schema.ToLedgerResponse(&entries[i]))
	}

	if nextCursor != "" {
		w.Header().Set("X-Next-Cursor", nextCursor)
	}

	writeJSON(w, http.StatusOK, responses)
}

// Recompute handles POST /reputation/{userId}/recompute
func (h *ReputationHandler) Recompute(w http.ResponseWriter, r *http.Request) {
	userIdStr := r.PathValue("userId")
	if userIdStr == "" {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Missing userId path parameter")
		return
	}

	userID, err := uuid.Parse(userIdStr)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid_user_id", "Invalid userId format")
		return
	}

	rep, err := h.service.Recompute(r.Context(), userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "internal_error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, schema.ToUserReputationResponse(rep))
}

// Health handles GET /health
func (h *ReputationHandler) Health(w http.ResponseWriter, r *http.Request) {
	dbStatus := "connected"
	if h.db != nil {
		if err := h.db.Ping(r.Context()); err != nil {
			dbStatus = "disconnected"
		}
	}

	brokerStatus := "connected"
	if h.rabbitmq == nil || !h.rabbitmq.IsHealthy() {
		brokerStatus = "disconnected"
	}

	status := "ok"
	httpCode := http.StatusOK
	if dbStatus != "connected" || brokerStatus != "connected" {
		status = "degraded"
		httpCode = http.StatusServiceUnavailable
	}

	writeJSON(w, httpCode, schema.HealthResponse{
		Status:   status,
		Database: dbStatus,
		Broker:   brokerStatus,
	})
}
