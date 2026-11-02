package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"rating/db"
	"rating/internal/config"
	"rating/internal/handler"
	"rating/internal/messaging"
	"rating/internal/repository"
	"rating/internal/service"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		slog.Error("Failed to run database migrations", "error", err)
		os.Exit(1)
	}

	pool, err := repository.NewDatabase(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	repo := repository.NewPostgresRatingRepository(pool)

	// El broker se conecta en segundo plano y se reconecta solo: el servicio
	// arranca y atiende votos aunque RabbitMQ no este disponible.
	broker := messaging.NewBroker(cfg.RabbitMQURL, cfg.RabbitMQExchange)
	ratingService := service.NewRatingService(repo, messaging.NewRatingEventPublisher(broker))
	broker.OnConnect(messaging.NewConsumer(ratingService).Setup)
	brokerDone := make(chan struct{})
	go func() {
		broker.Run(ctx)
		close(brokerDone)
	}()

	h := handler.NewRatingHandler(
		ratingService,
		pool,
		broker,
		handler.NewRateLimiter(cfg.VotesPerMinute, time.Minute),
		handler.NewRateLimiter(cfg.BatchPerMinute, time.Minute),
	)
	mux := http.NewServeMux()
	h.Routes(mux)

	server := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           mux,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      10 * time.Second,
	}

	go func() {
		slog.Info("Rating service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-ctx.Done()
	slog.Info("Shutting down rating service...")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server shutdown failed", "error", err)
	}
	<-brokerDone
	slog.Info("Rating service stopped")
}
