package config

import (
	"fmt"
	"os"
	"strconv"
)

type Config struct {
	Port             string
	DatabaseURL      string
	RabbitMQURL      string
	RabbitMQExchange string
	// Limites por usuario y por minuto.
	VotesPerMinute int
	BatchPerMinute int
}

func Load() (*Config, error) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	votes, err := intEnv("RATE_LIMIT_VOTES_PER_MINUTE", 30)
	if err != nil {
		return nil, err
	}
	batch, err := intEnv("RATE_LIMIT_BATCH_PER_MINUTE", 100)
	if err != nil {
		return nil, err
	}

	return &Config{
		Port:             stringEnv("PORT", "8080"),
		DatabaseURL:      databaseURL,
		RabbitMQURL:      stringEnv("RABBITMQ_URL", "amqp://geopicto:geopicto@rabbitmq:5672/geopicto"),
		RabbitMQExchange: stringEnv("RABBITMQ_EXCHANGE", "geopicto.events"),
		VotesPerMinute:   votes,
		BatchPerMinute:   batch,
	}, nil
}

func stringEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func intEnv(key string, def int) (int, error) {
	v := os.Getenv(key)
	if v == "" {
		return def, nil
	}
	n, err := strconv.Atoi(v)
	if err != nil || n <= 0 {
		return 0, fmt.Errorf("%s must be a positive integer", key)
	}
	return n, nil
}
