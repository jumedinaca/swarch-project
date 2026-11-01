package schema

import (
	"time"

	"github.com/google/uuid"

	"reputation/internal/domain"
)

type UserReputationResponse struct {
	UserID           string   `json:"userId"`
	Score            int      `json:"score"`
	Level            string   `json:"level"`
	LevelIndex       int      `json:"levelIndex"`
	NextLevelAt      *int     `json:"nextLevelAt"`
	Progress         float64  `json:"progress"`
	LikesReceived    int      `json:"likesReceived"`
	DislikesReceived int      `json:"dislikesReceived"`
	MessagesBlocked  int      `json:"messagesBlocked"`
	MessagesWarned   int      `json:"messagesWarned"`
	UpdatedAt        string   `json:"updatedAt"`
}

type ReputationLedgerResponse struct {
	ID            string `json:"id"`
	UserID        string `json:"userId"`
	Delta         int    `json:"delta"`
	AppliedDelta  int    `json:"appliedDelta"`
	Reason        string `json:"reason"`
	SourceEventID string `json:"sourceEventId"`
	DedupeKey     string `json:"dedupeKey"`
	ScoreAfter    int    `json:"scoreAfter"`
	CreatedAt     string `json:"createdAt"`
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

// ToUserReputationResponse converts domain.UserReputation to API response.
func ToUserReputationResponse(rep *domain.UserReputation) UserReputationResponse {
	if rep == nil {
		levelInfo := domain.LevelFor(0)
		return UserReputationResponse{
			UserID:           uuid.Nil.String(),
			Score:            0,
			Level:            levelInfo.Level,
			LevelIndex:       levelInfo.LevelIndex,
			NextLevelAt:      levelInfo.NextLevelAt,
			Progress:         levelInfo.Progress,
			LikesReceived:    0,
			DislikesReceived: 0,
			MessagesBlocked:  0,
			MessagesWarned:   0,
			UpdatedAt:        time.Now().UTC().Format(time.RFC3339),
		}
	}

	levelInfo := domain.LevelFor(rep.Score)
	return UserReputationResponse{
		UserID:           rep.UserID.String(),
		Score:            rep.Score,
		Level:            levelInfo.Level,
		LevelIndex:       levelInfo.LevelIndex,
		NextLevelAt:      levelInfo.NextLevelAt,
		Progress:         levelInfo.Progress,
		LikesReceived:    rep.LikesReceived,
		DislikesReceived: rep.DislikesReceived,
		MessagesBlocked:  rep.MessagesBlocked,
		MessagesWarned:   rep.MessagesWarned,
		UpdatedAt:        rep.UpdatedAt.UTC().Format(time.RFC3339),
	}
}

// ToLedgerResponse converts domain.ReputationLedger to API response.
func ToLedgerResponse(l *domain.ReputationLedger) ReputationLedgerResponse {
	return ReputationLedgerResponse{
		ID:            l.ID.String(),
		UserID:        l.UserID.String(),
		Delta:         l.Delta,
		AppliedDelta:  l.AppliedDelta,
		Reason:        l.Reason,
		SourceEventID: l.SourceEventID.String(),
		DedupeKey:     l.DedupeKey,
		ScoreAfter:    l.ScoreAfter,
		CreatedAt:     l.CreatedAt.UTC().Format(time.RFC3339),
	}
}
