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

	"reputation/db"
	"reputation/internal/config"
	"reputation/internal/handler"
	"reputation/internal/messaging"
	"reputation/internal/repository"
	"reputation/internal/service"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	}))
	slog.SetDefault(logger)

	cfg, err := config.Load()
	if err != nil {
		slog.Error("Failed to load configuration", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// 1. Run migrations
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		slog.Error("Failed to run database migrations", "error", err)
		os.Exit(1)
	}

	// 2. Connect to database
	pool, err := repository.NewDatabase(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to connect to database pool", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// 3. Repository
	reputationRepo := repository.NewPostgresReputationRepository(pool)

	// 4. RabbitMQ
	rabbitConn := messaging.NewRabbitMQConnection(cfg.RabbitMQURL, cfg.RabbitMQExchange)
	var publisher *messaging.RabbitMQPublisher
	var consumer *messaging.RabbitMQConsumer

	if err := rabbitConn.Connect(); err != nil {
		slog.Warn("Could not immediately connect to RabbitMQ, starting background reconnect loop", "error", err)
		go func() {
			if recErr := rabbitConn.EnsureConnection(ctx); recErr == nil {
				slog.Info("Successfully connected to RabbitMQ after retry")
				if consumer != nil {
					if startErr := consumer.Start(ctx); startErr != nil {
						slog.Error("Failed starting RabbitMQ consumer after reconnect", "error", startErr)
					}
				}
			}
		}()
	}

	publisher = messaging.NewRabbitMQPublisher(rabbitConn)

	// 5. Service
	reputationService := service.NewReputationService(reputationRepo, publisher)

	// 6. Consumer
	consumer = messaging.NewRabbitMQConsumer(rabbitConn, reputationService)
	if rabbitConn.IsHealthy() {
		if err := consumer.Start(ctx); err != nil {
			slog.Error("Failed to start RabbitMQ consumer", "error", err)
		}
	}

	// 7. Handler
	reputationHandler := handler.NewReputationHandler(reputationService, pool, rabbitConn)

	// 8. Router
	mux := http.NewServeMux()

	mux.HandleFunc("GET /reputation/me", reputationHandler.GetMe)
	mux.HandleFunc("GET /reputation/leaderboard", reputationHandler.GetLeaderboard)
	mux.HandleFunc("GET /reputation/{userId}", reputationHandler.GetByUserID)
	mux.HandleFunc("GET /reputation/{userId}/history", reputationHandler.GetHistory)
	mux.HandleFunc("POST /reputation/{userId}/recompute", reputationHandler.Recompute)
	mux.HandleFunc("GET /health", reputationHandler.Health)
	mux.HandleFunc("GET /reputation/health", reputationHandler.Health)

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	// Graceful shutdown channel
	shutdownChan := make(chan os.Signal, 1)
	signal.Notify(shutdownChan, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("Reputation service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-shutdownChan
	slog.Info("Shutting down reputation service gracefully...")

	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server graceful shutdown failed", "error", err)
	}

	rabbitConn.Close()
	slog.Info("Reputation service stopped")
}
