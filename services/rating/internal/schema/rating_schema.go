package schema

import (
	"github.com/google/uuid"

	"rating/internal/domain"
)

// MaxBatchSize es el maximo de mensajes por peticion batch.
const MaxBatchSize = 100

type RateRequest struct {
	Value string `json:"value"`
}

type BatchRequest struct {
	MessageIDs []string `json:"messageIds"`
}

// RatingSummaryResponse es la respuesta de todos los endpoints de rating.
// MyRating es "LIKE", "DISLIKE" o null.
type RatingSummaryResponse struct {
	MessageID uuid.UUID `json:"messageId"`
	Likes     int       `json:"likes"`
	Dislikes  int       `json:"dislikes"`
	Score     int       `json:"score"`
	MyRating  *string   `json:"myRating"`
}

func ToSummaryResponse(s domain.Summary) RatingSummaryResponse {
	return RatingSummaryResponse{
		MessageID: s.MessageID,
		Likes:     s.Likes,
		Dislikes:  s.Dislikes,
		Score:     s.Score(),
		MyRating:  s.MyRating.Label(),
	}
}

type ErrorResponse struct {
	Error   string `json:"error"`
	Message string `json:"message"`
}

type HealthResponse struct {
	Status   string `json:"status"`
	Database string `json:"database"`
	Broker   string `json:"broker"`
}
