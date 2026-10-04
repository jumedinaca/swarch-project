package handler

import (
	"encoding/json"
	"net/http"

	"github.com/google/uuid"

	"messages/internal/domain"
	"messages/internal/service"
	"messages/internal/schema"
)

type MessageHandler struct {
	service *service.MessageService
}

func NewMessageHandler(
	service *service.MessageService,
) *MessageHandler {
	return &MessageHandler{
		service: service,
	}
}


func (h *MessageHandler) CreateMessage(
	w http.ResponseWriter,
	r *http.Request,
) {
	userIDHeader := r.Header.Get("X-User-ID")

	userID, err := uuid.Parse(userIDHeader)
	if err != nil {
		http.Error(w, "invalid user id", http.StatusUnauthorized)
		return
	}

	var req schema.CreateMessageRequest

	err = json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		http.Error(
			w,
			"invalid request body",
			http.StatusBadRequest,
		)
		return
	}

	message := &domain.Message{
		SenderID: userID,
		Content:  req.Content,
		Location: domain.Location{
			Latitude:  req.Latitude,
			Longitude: req.Longitude,
		},
	}

	var msg *domain.Message

	msg, err = h.service.CreateMessage(
		r.Context(),
		message,
	)

	if err != nil {
		http.Error(
			w,
			err.Error(),
			http.StatusBadRequest,
		)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusCreated)
	json.NewEncoder(w).Encode(msg)
}

func (h *MessageHandler) DeleteMessage(
    w http.ResponseWriter,
    r *http.Request,
) {
    messageID, err := uuid.Parse(r.PathValue("id"))
    if err != nil {
        http.Error(w, "invalid message id", http.StatusBadRequest)
        return
    }

    userID, err := uuid.Parse(r.Header.Get("X-User-ID"))
    if err != nil {
        http.Error(w, "invalid user id", http.StatusUnauthorized)
        return
    }

    err = h.service.DeleteMessage(
        r.Context(),
        messageID,
        userID,
    )

    if err != nil {
        http.Error(w, err.Error(), http.StatusNotFound)
        return
    }

    w.WriteHeader(http.StatusOK)
}

func (h *MessageHandler) GetMessageById(
    w http.ResponseWriter,
    r *http.Request,
) {
    messageID, err := uuid.Parse(r.PathValue("id"))
    if err != nil {
        http.Error(w, "invalid message id", http.StatusBadRequest)
        return
    }

    userID, err := uuid.Parse(r.Header.Get("X-User-ID"))
    if err != nil {
        http.Error(w, "invalid user id", http.StatusUnauthorized)
        return
    }

    message, err := h.service.GetMessageById(
        r.Context(),
        messageID,
        userID,
    )

    if err != nil {
        http.Error(w, err.Error(), http.StatusNotFound)
        return
    }

	w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(http.StatusOK)
	json.NewEncoder(w).Encode(message)
}



func (h *MessageHandler) GetNearbyMessages (
	w http.ResponseWriter,
	r *http.Request,
) {
	var req schema.NearbyRequest

	err := json.NewDecoder(r.Body).Decode(&req)
	if err != nil {
		http.Error(
			w,
			"invalid request body",
			http.StatusBadRequest,
		)
		return
	}

	messages, err := h.service.GetNearby(
		r.Context(),
		req.Latitude,
		req.Longitude,
		req.Radius,
	)

	if err != nil {
		http.Error(
			w,
			err.Error(),
			http.StatusBadRequest,
		)
		return
	}

	w.Header().Set("Content-Type", "application/json")

	w.WriteHeader(http.StatusOK)

	json.NewEncoder(w).Encode(messages)
}
