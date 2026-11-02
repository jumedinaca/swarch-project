package main

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"sync/atomic"
	"syscall"
	"time"

	"messages/db"
	"messages/internal/config"
	"messages/internal/handler"
	"messages/internal/messaging"
	"messages/internal/middleware"
	"messages/internal/repository"
	"messages/internal/service"
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

	// 1. Migraciones
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		slog.Error("Failed to run database migrations", "error", err)
		os.Exit(1)
	}

	// 2. Base de datos
	pool, err := repository.NewDatabase(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("Failed to connect to database", "error", err)
		os.Exit(1)
	}
	defer pool.Close()

	// 3. Repositorio
	messageRepository := repository.NewPostgresMessageRepository(pool)

	// 4. RabbitMQ (opcional: si no hay RABBITMQ_URL el servicio sigue operando)
	// Se usan conexiones separadas para publicar y consumir: así una
	// reconexión del publicador no cierra el canal del consumidor.
	var publisherConn *messaging.RabbitMQConnection
	var consumerConn *messaging.RabbitMQConnection
	var publisher service.EventPublisher

	if cfg.RabbitMQURL != "" {
		publisherConn = messaging.NewRabbitMQConnection(cfg.RabbitMQURL, cfg.RabbitMQExchange)
		consumerConn = messaging.NewRabbitMQConnection(cfg.RabbitMQURL, cfg.RabbitMQExchange)

		if err := publisherConn.Connect(); err != nil {
			slog.Warn("Could not connect to RabbitMQ at startup; will retry on publish",
				"error", err,
			)
		}
		publisher = messaging.NewRabbitMQPublisher(publisherConn)
	} else {
		slog.Warn("RABBITMQ_URL is empty; event publishing and moderation consumer are disabled")
	}

	// 5. Servicio
	messageService := service.NewMessageService(
		messageRepository,
		publisher,
		cfg.ModerationTimeout,
		cfg.PendingSweepInterval,
		cfg.FailOpen,
		cfg.FailClosed,
	)

	// 6. Consumidor de moderación
	if consumerConn != nil {
		consumer := messaging.NewRabbitMQConsumer(consumerConn, messageService)
		var consumerStarted atomic.Bool

		startConsumer := func() {
			if !consumerStarted.CompareAndSwap(false, true) {
				return
			}
			if err := consumer.Start(ctx); err != nil {
				consumerStarted.Store(false)
				slog.Warn("Failed to start RabbitMQ consumer; will retry", "error", err)
				return
			}
			slog.Info("RabbitMQ moderation consumer started")
		}

		// El primer intento no bloquea el arranque HTTP; si el broker está
		// caído, el bucle de abajo reintenta cada 5 segundos.
		go startConsumer()

		go func() {
			ticker := time.NewTicker(5 * time.Second)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					// Si el canal de consumo se cerró (caída del broker o
					// error del canal), se reconecta y se vuelve a consumir.
					if !consumerConn.IsHealthy() {
						consumerStarted.Store(false)
						if err := consumerConn.Connect(); err != nil {
							slog.Debug("RabbitMQ still unavailable", "error", err)
							continue
						}
					}
					startConsumer()
				}
			}
		}()
	}

	// 7. Barrido de mensajes PENDING que superaron el timeout de moderación.
	go func() {
		ticker := time.NewTicker(cfg.PendingSweepInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				messageService.SweepStalePending(ctx)
			}
		}
	}()

	// 8. Handler y rutas
	messageHandler := handler.NewMessageHandler(messageService)
	requireJWT := middleware.JWTAuth(cfg.JWTSecret, cfg.JWTIssuer, cfg.JWTLeeway)

	mux := http.NewServeMux()

	mux.Handle("POST /messages", requireJWT(http.HandlerFunc(messageHandler.CreateMessage)))
	mux.Handle("GET /messages/{id}", requireJWT(http.HandlerFunc(messageHandler.GetMessageById)))
	mux.Handle("DELETE /messages/{id}", requireJWT(http.HandlerFunc(messageHandler.DeleteMessage)))

	// nearby es pública, igual que en el gateway.
	mux.HandleFunc("GET /messages/nearby", messageHandler.GetNearbyMessages)

	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		status := "ok"
		httpStatus := http.StatusOK

		pingCtx, pingCancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer pingCancel()
		if err := pool.Ping(pingCtx); err != nil {
			status = "degraded"
			httpStatus = http.StatusServiceUnavailable
		}

		broker := "disabled"
		if publisherConn != nil {
			if publisherConn.IsHealthy() && (consumerConn == nil || consumerConn.IsHealthy()) {
				broker = "up"
			} else {
				broker = "down"
			}
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(httpStatus)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"status": status,
			"broker": broker,
		})
	})

	server := &http.Server{
		Addr:         ":" + cfg.Port,
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
	}

	shutdown := make(chan os.Signal, 1)
	signal.Notify(shutdown, os.Interrupt, syscall.SIGTERM)

	go func() {
		slog.Info("Messages service listening", "port", cfg.Port)
		if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("HTTP server failed", "error", err)
			os.Exit(1)
		}
	}()

	<-shutdown
	slog.Info("Shutting down messages service...")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server graceful shutdown failed", "error", err)
	}

	if publisherConn != nil {
		publisherConn.Close()
	}
	if consumerConn != nil {
		consumerConn.Close()
	}
	slog.Info("Messages service stopped")
}
