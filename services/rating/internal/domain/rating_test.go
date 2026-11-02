package domain

import (
	"errors"
	"testing"

	"github.com/google/uuid"
)

func TestParseValue(t *testing.T) {
	cases := map[string]struct {
		want Value
		err  error
	}{
		"LIKE":    {Like, nil},
		"DISLIKE": {Dislike, nil},
		"like":    {None, ErrInvalidValue},
		"":        {None, ErrInvalidValue},
		"NONE":    {None, ErrInvalidValue},
	}
	for in, tc := range cases {
		got, err := ParseValue(in)
		if got != tc.want || !errors.Is(err, tc.err) {
			t.Errorf("ParseValue(%q) = %v, %v; want %v, %v", in, got, err, tc.want, tc.err)
		}
	}
}

func TestLabel(t *testing.T) {
	if l := Like.Label(); l == nil || *l != "LIKE" {
		t.Errorf("Like.Label() = %v", l)
	}
	if l := Dislike.Label(); l == nil || *l != "DISLIKE" {
		t.Errorf("Dislike.Label() = %v", l)
	}
	if l := None.Label(); l != nil {
		t.Errorf("None.Label() = %v, want nil", *l)
	}
}

func TestApplyVote(t *testing.T) {
	cases := []struct {
		name            string
		likes, dislikes int
		prev, next      Value
		wantL, wantD    int
	}{
		{"nuevo like", 0, 0, None, Like, 1, 0},
		{"nuevo dislike", 0, 0, None, Dislike, 0, 1},
		{"like a dislike", 5, 2, Like, Dislike, 4, 3},
		{"dislike a like", 5, 2, Dislike, Like, 6, 1},
		{"quitar like", 5, 2, Like, None, 4, 2},
		{"quitar dislike", 5, 2, Dislike, None, 5, 1},
		{"sin cambio", 5, 2, Like, Like, 5, 2},
	}
	for _, tc := range cases {
		l, d := ApplyVote(tc.likes, tc.dislikes, tc.prev, tc.next)
		if l != tc.wantL || d != tc.wantD {
			t.Errorf("%s: got (%d,%d), want (%d,%d)", tc.name, l, d, tc.wantL, tc.wantD)
		}
	}

	// like -> dislike mueve el score en -2; dislike -> like en +2.
	l, d := ApplyVote(3, 1, Like, Dislike)
	if delta := (l - d) - (3 - 1); delta != -2 {
		t.Errorf("like->dislike score delta = %d, want -2", delta)
	}
	l, d = ApplyVote(3, 1, Dislike, Like)
	if delta := (l - d) - (3 - 1); delta != 2 {
		t.Errorf("dislike->like score delta = %d, want 2", delta)
	}
}

func TestCheckRateable(t *testing.T) {
	author := uuid.New()
	rater := uuid.New()
	pub := &MessageProjection{MessageID: uuid.New(), AuthorID: author, Status: StatusPublished}

	if err := CheckRateable(nil, rater); !errors.Is(err, ErrMessageNotReady) {
		t.Errorf("nil projection: got %v", err)
	}
	if err := CheckRateable(pub, rater); err != nil {
		t.Errorf("published: got %v", err)
	}
	if err := CheckRateable(pub, author); !errors.Is(err, ErrSelfRating) {
		t.Errorf("self rating: got %v", err)
	}
	for _, st := range []MessageStatus{StatusBlocked, StatusDeleted} {
		p := *pub
		p.Status = st
		if err := CheckRateable(&p, rater); !errors.Is(err, ErrMessageNotRateable) {
			t.Errorf("%s: got %v", st, err)
		}
	}
}
