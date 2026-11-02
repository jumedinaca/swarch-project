package messaging

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
	"rating/internal/schema"
)

func TestRatingChangedEventShape(t *testing.T) {
	change := &domain.VoteChange{
		Changed:   true,
		RatingID:  uuid.New(),
		MessageID: uuid.New(),
		AuthorID:  uuid.New(),
		RaterID:   uuid.New(),
		Previous:  domain.Like,
		Value:     domain.Dislike,
		Likes:     11,
		Dislikes:  3,
		ChangedAt: time.Date(2026, 10, 24, 14, 30, 0, 0, time.UTC),
	}

	body, err := json.Marshal(BuildRatingChangedEvent(change, "corr-1"))
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatal(err)
	}

	if m["eventType"] != "rating.changed.v1" || m["version"] != 1.0 || m["producer"] != "rating" ||
		m["correlationId"] != "corr-1" || m["occurredAt"] != "2026-10-24T14:30:00Z" {
		t.Fatalf("envelope: %v", m)
	}
	if _, err := uuid.Parse(m["eventId"].(string)); err != nil {
		t.Fatalf("eventId: %v", err)
	}
	p := m["payload"].(map[string]any)
	want := map[string]any{
		"ratingId":        change.RatingID.String(),
		"messageId":       change.MessageID.String(),
		"messageAuthorId": change.AuthorID.String(),
		"raterId":         change.RaterID.String(),
		"previousValue":   1.0,
		"value":           -1.0,
		"likes":           11.0,
		"dislikes":        3.0,
		"changedAt":       "2026-10-24T14:30:00Z",
	}
	for k, v := range want {
		if p[k] != v {
			t.Errorf("payload.%s = %v, want %v", k, p[k], v)
		}
	}

	// Sin correlationId se usa el eventId.
	evt := BuildRatingChangedEvent(change, "")
	if evt.CorrelationID != evt.EventID.String() {
		t.Errorf("correlationId = %s, want eventId", evt.CorrelationID)
	}
}

type recordingHandler struct {
	published []schema.MessagePublishedPayload
	deleted   []schema.MessageDeletedPayload
	err       error
}

func (h *recordingHandler) HandleMessagePublished(_ context.Context, _ *schema.IncomingEvent, p *schema.MessagePublishedPayload) error {
	h.published = append(h.published, *p)
	return h.err
}

func (h *recordingHandler) HandleMessageDeleted(_ context.Context, _ *schema.IncomingEvent, p *schema.MessageDeletedPayload) error {
	h.deleted = append(h.deleted, *p)
	return h.err
}

func TestConsumerDecoding(t *testing.T) {
	h := &recordingHandler{}
	c := NewConsumer(h)
	ctx := context.Background()
	msg, author := uuid.New(), uuid.New()

	published := `{"eventId":"e1","eventType":"message.published.v1","version":1,
		"occurredAt":"2026-10-24T14:30:00Z","producer":"messages","correlationId":"c1","causationId":null,
		"payload":{"messageId":"` + msg.String() + `","authorId":"` + author.String() + `",
		"contentPreview":"hola","latitude":4.6,"longitude":-74.0,"moderationDecision":"WARN",
		"publishedAt":"2026-10-24T14:30:02Z"}}`
	if err := c.handlePublished(ctx, []byte(published)); err != nil {
		t.Fatal(err)
	}
	if len(h.published) != 1 || h.published[0].MessageID != msg || h.published[0].AuthorID != author {
		t.Fatalf("published: %+v", h.published)
	}

	deleted := `{"eventId":"e2","eventType":"message.deleted.v1","payload":{"messageId":"` + msg.String() + `"}}`
	if err := c.handleDeleted(ctx, []byte(deleted)); err != nil {
		t.Fatal(err)
	}
	if len(h.deleted) != 1 || h.deleted[0].MessageID != msg {
		t.Fatalf("deleted: %+v", h.deleted)
	}

	poison := []string{
		`not json`,
		`{"eventType":"message.published.v1"}`,
		`{"payload":{"messageId":"` + msg.String() + `"}}`, // sin authorId
		`{"payload":{"messageId":"nope","authorId":"` + author.String() + `"}}`,
	}
	for _, body := range poison {
		if err := c.handlePublished(ctx, []byte(body)); !errors.Is(err, errPoison) {
			t.Errorf("%s: got %v, want poison", body, err)
		}
	}

	// Un error del handler (p. ej. base de datos) no es poison: se reencola.
	h.err = errors.New("db down")
	if err := c.handleDeleted(ctx, []byte(deleted)); err == nil || errors.Is(err, errPoison) {
		t.Errorf("transient error classified as poison: %v", err)
	}
}
