package repository_test

// Pruebas de integracion contra PostgreSQL real. Se saltan si no se define
// RATING_TEST_DATABASE_URL, por ejemplo:
//
//	RATING_TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5437/rating?sslmode=disable go test ./...

import (
	"context"
	"errors"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"rating/db"
	"rating/internal/domain"
	"rating/internal/repository"
)

func setup(t *testing.T) (*repository.PostgresRatingRepository, *pgxpool.Pool) {
	t.Helper()
	url := os.Getenv("RATING_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("RATING_TEST_DATABASE_URL not set")
	}
	if err := db.RunMigrations(url); err != nil {
		t.Fatal(err)
	}
	pool, err := repository.NewDatabase(context.Background(), url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(pool.Close)
	return repository.NewPostgresRatingRepository(pool), pool
}

func published(t *testing.T, repo *repository.PostgresRatingRepository) (message, author uuid.UUID) {
	t.Helper()
	message, author = uuid.New(), uuid.New()
	if err := repo.UpsertPublished(context.Background(), message, author, time.Now()); err != nil {
		t.Fatal(err)
	}
	return message, author
}

func dbCounts(t *testing.T, pool *pgxpool.Pool, message uuid.UUID) (likes, dislikes, score, rows int) {
	t.Helper()
	ctx := context.Background()
	err := pool.QueryRow(ctx,
		`SELECT likes, dislikes, score FROM message_rating_stats WHERE message_id = $1`, message).
		Scan(&likes, &dislikes, &score)
	if err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM message_ratings WHERE message_id = $1`, message).Scan(&rows); err != nil {
		t.Fatal(err)
	}
	return
}

func TestVoteLifecycle(t *testing.T) {
	repo, pool := setup(t)
	ctx := context.Background()
	message, author := published(t, repo)
	rater := uuid.New()

	c, err := repo.SetVote(ctx, message, rater, domain.Like)
	if err != nil {
		t.Fatal(err)
	}
	if !c.Changed || c.Previous != domain.None || c.Likes != 1 || c.AuthorID != author || c.RatingID == uuid.Nil {
		t.Fatalf("like: %+v", c)
	}
	firstID := c.RatingID

	// Mismo voto: no cambia nada.
	c, err = repo.SetVote(ctx, message, rater, domain.Like)
	if err != nil || c.Changed || c.Likes != 1 {
		t.Fatalf("repeat like: %+v %v", c, err)
	}

	c, err = repo.SetVote(ctx, message, rater, domain.Dislike)
	if err != nil || !c.Changed || c.Previous != domain.Like || c.Likes != 0 || c.Dislikes != 1 || c.RatingID != firstID {
		t.Fatalf("to dislike: %+v %v", c, err)
	}
	if l, d, s, n := dbCounts(t, pool, message); l != 0 || d != 1 || s != -1 || n != 1 {
		t.Fatalf("db after dislike: %d %d %d %d", l, d, s, n)
	}

	c, err = repo.SetVote(ctx, message, rater, domain.None)
	if err != nil || !c.Changed || c.Previous != domain.Dislike || c.Value != domain.None || c.RatingID != firstID {
		t.Fatalf("remove: %+v %v", c, err)
	}
	if l, d, s, n := dbCounts(t, pool, message); l != 0 || d != 0 || s != 0 || n != 0 {
		t.Fatalf("db after remove: %d %d %d %d", l, d, s, n)
	}

	c, err = repo.SetVote(ctx, message, rater, domain.None)
	if err != nil || c.Changed {
		t.Fatalf("remove twice: %+v %v", c, err)
	}
}

func TestRules(t *testing.T) {
	repo, _ := setup(t)
	ctx := context.Background()
	message, author := published(t, repo)

	if _, err := repo.SetVote(ctx, message, author, domain.Like); !errors.Is(err, domain.ErrSelfRating) {
		t.Errorf("self: %v", err)
	}
	if _, err := repo.SetVote(ctx, uuid.New(), uuid.New(), domain.Like); !errors.Is(err, domain.ErrMessageNotReady) {
		t.Errorf("unknown: %v", err)
	}
	if err := repo.MarkDeleted(ctx, message, author, time.Now()); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetVote(ctx, message, uuid.New(), domain.Like); !errors.Is(err, domain.ErrMessageNotRateable) {
		t.Errorf("deleted: %v", err)
	}
}

func TestDeletedBeforePublished(t *testing.T) {
	repo, _ := setup(t)
	ctx := context.Background()
	message, author := uuid.New(), uuid.New()

	if err := repo.MarkDeleted(ctx, message, uuid.Nil, time.Now()); err != nil {
		t.Fatal(err)
	}
	if err := repo.UpsertPublished(ctx, message, author, time.Now()); err != nil {
		t.Fatal(err)
	}
	p, err := repo.GetProjection(ctx, message)
	if err != nil {
		t.Fatal(err)
	}
	if p.Status != domain.StatusDeleted || p.AuthorID != author {
		t.Fatalf("projection = %+v, want DELETED with author", p)
	}

	// Reprocesar message.published es idempotente.
	if err := repo.UpsertPublished(ctx, message, author, time.Now()); err != nil {
		t.Fatal(err)
	}
	if p, _ = repo.GetProjection(ctx, message); p.Status != domain.StatusDeleted {
		t.Fatalf("status = %s after duplicate publish", p.Status)
	}
}

// Muchos usuarios votando el mismo mensaje a la vez: ningun voto se pierde.
func TestConcurrentVotesSameMessage(t *testing.T) {
	repo, pool := setup(t)
	message, _ := published(t, repo)

	const n = 60
	var wg sync.WaitGroup
	errs := make(chan error, n)
	for i := range n {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v := domain.Like
			if i%3 == 0 {
				v = domain.Dislike
			}
			if _, err := repo.SetVote(context.Background(), message, uuid.New(), v); err != nil {
				errs <- err
			}
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatal(err)
	}

	l, d, s, rows := dbCounts(t, pool, message)
	if l != 40 || d != 20 || s != 20 || rows != n {
		t.Fatalf("counts = likes %d dislikes %d score %d rows %d; want 40 20 20 %d", l, d, s, rows, n)
	}
}

// El mismo usuario enviando votos en paralelo: un solo voto final y conteos
// coherentes con el.
func TestConcurrentVotesSameUser(t *testing.T) {
	repo, pool := setup(t)
	message, _ := published(t, repo)
	rater := uuid.New()

	var wg sync.WaitGroup
	for i := range 40 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			v := []domain.Value{domain.Like, domain.Dislike, domain.None, domain.Like}[i%4]
			if _, err := repo.SetVote(context.Background(), message, rater, v); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()

	l, d, s, rows := dbCounts(t, pool, message)
	if rows > 1 || l+d != rows || s != l-d {
		t.Fatalf("inconsistent: likes %d dislikes %d score %d rows %d", l, d, s, rows)
	}
}

func TestGetSummariesSingleQueryOrder(t *testing.T) {
	repo, _ := setup(t)
	ctx := context.Background()
	m1, _ := published(t, repo)
	m2, _ := published(t, repo)
	me := uuid.New()

	if _, err := repo.SetVote(ctx, m1, me, domain.Dislike); err != nil {
		t.Fatal(err)
	}
	if _, err := repo.SetVote(ctx, m2, uuid.New(), domain.Like); err != nil {
		t.Fatal(err)
	}

	unknown := uuid.New()
	got, err := repo.GetSummaries(ctx, []uuid.UUID{m2, unknown, m1}, me)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 || got[0].MessageID != m2 || got[1].MessageID != unknown || got[2].MessageID != m1 {
		t.Fatalf("order: %+v", got)
	}
	if got[0].Likes != 1 || got[0].MyRating != domain.None {
		t.Errorf("m2: %+v", got[0])
	}
	if got[1].Likes != 0 || got[1].Dislikes != 0 {
		t.Errorf("unknown: %+v", got[1])
	}
	if got[2].Dislikes != 1 || got[2].MyRating != domain.Dislike {
		t.Errorf("m1: %+v", got[2])
	}

	// 100 ids en una sola llamada.
	ids := make([]uuid.UUID, 100)
	for i := range ids {
		ids[i] = uuid.New()
	}
	if got, err = repo.GetSummaries(ctx, ids, me); err != nil || len(got) != 100 {
		t.Fatalf("batch 100: %d %v", len(got), err)
	}
}
