package handler

import (
	"encoding/json"
	"net/http"

	"reputation/internal/schema"
)

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeError(w http.ResponseWriter, status int, errorCode string, message string) {
	writeJSON(w, status, schema.ErrorResponse{
		Error:   errorCode,
		Message: message,
	})
}
