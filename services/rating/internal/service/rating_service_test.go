package service_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"rating/internal/domain"
	"rating/internal/schema"
	"rating/internal/service"
	"rating/internal/testutil"
)

type fixture struct {
	repo    *testutil.MemoryRepo
	pub     *testutil.RecordingPublisher
	svc     *service.RatingService
	author  uuid.UUID
	rater   uuid.UUID
	message uuid.UUID
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{
		repo:    testutil.NewMemoryRepo(),
		pub:     &testutil.RecordingPublisher{},
		author:  uuid.New(),
		rater:   uuid.New(),
		message: uuid.New(),
	}
	f.svc = service.NewRatingService(f.repo, f.pub)
	f.publish(t, f.message, f.author)
	return f
}

func (f *fixture) publish(t *testing.T, messageID, authorID uuid.UUID) {
	t.Helper()
	err := f.svc.HandleMessagePublished(context.Background(),
		&schema.IncomingEvent{EventID: uuid.NewString()},
		&schema.MessagePublishedPayload{MessageID: messageID, AuthorID: authorID, PublishedAt: time.Now()})
	if err != nil {
		t.Fatal(err)
	}
}

func (f *fixture) deleteMsg(t *testing.T, messageID uuid.UUID) {
	t.Helper()
	err := f.svc.HandleMessageDeleted(context.Background(),
		&schema.IncomingEvent{EventID: uuid.NewString()},
		&schema.MessageDeletedPayload{MessageID: messageID})
	if err != nil {
		t.Fatal(err)
	}
}

func assertSummary(t *testing.T, s domain.Summary, likes, dislikes int, my domain.Value) {
	t.Helper()
	if s.Likes != likes || s.Dislikes != dislikes || s.MyRating != my {
		t.Fatalf("summary = {likes:%d dislikes:%d my:%d}, want {likes:%d dislikes:%d my:%d}",
			s.Likes, s.Dislikes, s.MyRating, likes, dislikes, my)
	}
	if s.Score() != likes-dislikes {
		t.Fatalf("score = %d, want %d", s.Score(), likes-dislikes)
	}
}

func TestLikeChangeToDislikeAndRemove(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	s, err := f.svc.Rate(ctx, f.rater, f.message, domain.Like, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, s, 1, 0, domain.Like)

	s, err = f.svc.Rate(ctx, f.rater, f.message, domain.Dislike, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, s, 0, 1, domain.Dislike)

	s, err = f.svc.Remove(ctx, f.rater, f.message, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, s, 0, 0, domain.None)

	if f.pub.Count() != 3 {
		t.Fatalf("published %d events, want 3", f.pub.Count())
	}
	want := []struct{ prev, value domain.Value }{
		{domain.None, domain.Like},
		{domain.Like, domain.Dislike},
		{domain.Dislike, domain.None},
	}
	for i, w := range want {
		c := f.pub.Changes[i]
		if c.Previous != w.prev || c.Value != w.value {
			t.Errorf("event %d: prev=%d value=%d, want prev=%d value=%d", i, c.Previous, c.Value, w.prev, w.value)
		}
		if c.AuthorID != f.author {
			t.Errorf("event %d: messageAuthorId=%s, want %s", i, c.AuthorID, f.author)
		}
		if c.RaterID != f.rater || c.MessageID != f.message {
			t.Errorf("event %d: wrong rater or message", i)
		}
	}
	// El ratingId se mantiene al cambiar el voto y en la eliminacion.
	if f.pub.Changes[0].RatingID == uuid.Nil ||
		f.pub.Changes[1].RatingID != f.pub.Changes[0].RatingID ||
		f.pub.Changes[2].RatingID != f.pub.Changes[0].RatingID {
		t.Errorf("ratingId not stable across changes: %v", f.pub.Changes)
	}
}

func TestRepeatedPutIsIdempotent(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	for range 3 {
		s, err := f.svc.Rate(ctx, f.rater, f.message, domain.Like, "")
		if err != nil {
			t.Fatal(err)
		}
		assertSummary(t, s, 1, 0, domain.Like)
	}
	if f.pub.Count() != 1 {
		t.Fatalf("published %d events, want 1", f.pub.Count())
	}
}

func TestRemoveWithoutVoteEmitsNothing(t *testing.T) {
	f := newFixture(t)
	s, err := f.svc.Remove(context.Background(), f.rater, f.message, "")
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, s, 0, 0, domain.None)
	if f.pub.Count() != 0 {
		t.Fatalf("published %d events, want 0", f.pub.Count())
	}
}

func TestRules(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()

	if _, err := f.svc.Rate(ctx, f.author, f.message, domain.Like, ""); !errors.Is(err, domain.ErrSelfRating) {
		t.Errorf("self rating: got %v", err)
	}
	if _, err := f.svc.Rate(ctx, f.rater, uuid.New(), domain.Like, ""); !errors.Is(err, domain.ErrMessageNotReady) {
		t.Errorf("unknown message: got %v", err)
	}
	if _, err := f.svc.Rate(ctx, f.rater, f.message, domain.None, ""); !errors.Is(err, domain.ErrInvalidValue) {
		t.Errorf("None via Rate: got %v", err)
	}

	f.repo.SetStatus(f.message, domain.StatusBlocked)
	if _, err := f.svc.Rate(ctx, f.rater, f.message, domain.Like, ""); !errors.Is(err, domain.ErrMessageNotRateable) {
		t.Errorf("blocked: got %v", err)
	}

	f.deleteMsg(t, f.message)
	if _, err := f.svc.Rate(ctx, f.rater, f.message, domain.Like, ""); !errors.Is(err, domain.ErrMessageNotRateable) {
		t.Errorf("deleted: got %v", err)
	}
	if f.pub.Count() != 0 {
		t.Fatalf("published %d events on rejected votes", f.pub.Count())
	}
}

func TestDeletedBeforePublishedStaysDeleted(t *testing.T) {
	f := newFixture(t)
	late := uuid.New()

	f.deleteMsg(t, late)
	f.publish(t, late, f.author)

	if _, err := f.svc.Rate(context.Background(), f.rater, late, domain.Like, ""); !errors.Is(err, domain.ErrMessageNotRateable) {
		t.Fatalf("got %v, want message_not_rateable", err)
	}
	if _, err := f.svc.Get(context.Background(), f.rater, late); !errors.Is(err, domain.ErrMessageNotFound) {
		t.Fatalf("get deleted: got %v, want message_not_found", err)
	}
}

func TestPublishFailureKeepsVote(t *testing.T) {
	f := newFixture(t)
	f.pub.Err = errors.New("broker down")

	s, err := f.svc.Rate(context.Background(), f.rater, f.message, domain.Like, "")
	if err != nil {
		t.Fatalf("vote must succeed when the broker is down: %v", err)
	}
	assertSummary(t, s, 1, 0, domain.Like)

	got, err := f.svc.Get(context.Background(), f.rater, f.message)
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, got, 1, 0, domain.Like)
}

func TestGetAndBatch(t *testing.T) {
	f := newFixture(t)
	ctx := context.Background()
	other := uuid.New()
	f.publish(t, other, f.author)

	if _, err := f.svc.Rate(ctx, f.rater, f.message, domain.Like, ""); err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.Rate(ctx, uuid.New(), f.message, domain.Dislike, ""); err != nil {
		t.Fatal(err)
	}

	s, err := f.svc.Get(ctx, f.rater, f.message)
	if err != nil {
		t.Fatal(err)
	}
	assertSummary(t, s, 1, 1, domain.Like)

	if _, err := f.svc.Get(ctx, f.rater, uuid.New()); !errors.Is(err, domain.ErrMessageNotFound) {
		t.Errorf("get unknown: got %v", err)
	}

	unknown := uuid.New()
	list, err := f.svc.Batch(ctx, f.rater, []uuid.UUID{other, f.message, unknown, f.message})
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 3 {
		t.Fatalf("batch returned %d items, want 3 (duplicates removed)", len(list))
	}
	if list[0].MessageID != other || list[1].MessageID != f.message || list[2].MessageID != unknown {
		t.Fatalf("batch order not preserved: %v", list)
	}
	assertSummary(t, list[0], 0, 0, domain.None)
	assertSummary(t, list[1], 1, 1, domain.Like)
	assertSummary(t, list[2], 0, 0, domain.None)
}
