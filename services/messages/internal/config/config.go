package config

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

type Config struct {
	DatabaseURL string
	Port        string

	JWTSecret string
	JWTIssuer string
	JWTLeeway time.Duration

	RabbitMQURL      string
	RabbitMQExchange string

	ModerationTimeout    time.Duration
	PendingSweepInterval time.Duration
	FailOpen             bool
	FailClosed           bool
}

func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	port := os.Getenv("PORT")

	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}

	if port == "" {
		port = "8080"
	}

	jwtSecret := os.Getenv("JWT_SECRET")
	if jwtSecret == "" {
		return nil, fmt.Errorf("JWT_SECRET is required")
	}
	if len(jwtSecret) < 32 {
		return nil, fmt.Errorf("JWT_SECRET must be at least 32 bytes")
	}

	jwtIssuer := envString("JWT_ISSUER", "geopicto-auth")
	jwtLeeway := time.Duration(envInt("JWT_LEEWAY_SECONDS", 10)) * time.Second

	rabbitMQURL := os.Getenv("RABBITMQ_URL")
	rabbitMQExchange := envString("RABBITMQ_EXCHANGE", "geopicto.events")

	moderationTimeout := time.Duration(envInt("MODERATION_TIMEOUT_SECONDS", 10)) * time.Second
	if moderationTimeout <= 0 {
		return nil, fmt.Errorf("MODERATION_TIMEOUT_SECONDS must be greater than zero")
	}

	sweepInterval := time.Duration(envInt("PENDING_SWEEP_INTERVAL_SECONDS", 5)) * time.Second
	if sweepInterval <= 0 {
		return nil, fmt.Errorf("PENDING_SWEEP_INTERVAL_SECONDS must be greater than zero")
	}

	failClosed := envBool("FAIL_CLOSED", false)
	// FAIL_CLOSED tiene prioridad si ambas variables quedan activas.
	failOpen := envBool("FAIL_OPEN", !failClosed)

	return &Config{
		DatabaseURL:          databaseURL,
		Port:                 port,
		JWTSecret:            jwtSecret,
		JWTIssuer:            jwtIssuer,
		JWTLeeway:            jwtLeeway,
		RabbitMQURL:          rabbitMQURL,
		RabbitMQExchange:     rabbitMQExchange,
		ModerationTimeout:    moderationTimeout,
		PendingSweepInterval: sweepInterval,
		FailOpen:             failOpen,
		FailClosed:           failClosed,
	}, nil
}

func envString(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}

func envInt(name string, fallback int) int {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func envBool(name string, fallback bool) bool {
	value := os.Getenv(name)
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return fallback
	}
	return parsed
}
