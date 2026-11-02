package handler

import (
	"testing"
	"time"
)

func TestRateLimiterWindow(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewRateLimiter(2, time.Minute)
	l.now = func() time.Time { return now }

	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("1st should pass")
	}
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("2nd should pass")
	}
	ok, retry := l.Allow("a")
	if ok || retry != time.Minute {
		t.Fatalf("3rd: ok=%v retry=%v", ok, retry)
	}

	now = now.Add(40 * time.Second)
	if ok, retry := l.Allow("a"); ok || retry != 20*time.Second {
		t.Fatalf("still limited: ok=%v retry=%v", ok, retry)
	}

	now = now.Add(20 * time.Second)
	if ok, _ := l.Allow("a"); !ok {
		t.Fatal("new window should pass")
	}
}

func TestRateLimiterSweepsExpiredKeys(t *testing.T) {
	now := time.Unix(0, 0)
	l := NewRateLimiter(1, time.Minute)
	l.now = func() time.Time { return now }

	for _, k := range []string{"a", "b", "c"} {
		l.Allow(k)
	}
	now = now.Add(2 * time.Minute)
	l.Allow("d")
	if len(l.buckets) != 1 {
		t.Fatalf("buckets = %d, want 1", len(l.buckets))
	}
}
