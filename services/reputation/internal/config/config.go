package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port             string
	DatabaseURL      string
	RabbitMQURL      string
	RabbitMQExchange string
}

func Load() (*Config, error) {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL environment variable is required")
	}

	rabbitmqURL := os.Getenv("RABBITMQ_URL")
	if rabbitmqURL == "" {
		rabbitmqURL = "amqp://geopicto:geopicto@rabbitmq:5672/geopicto"
	}

	rabbitmqExchange := os.Getenv("RABBITMQ_EXCHANGE")
	if rabbitmqExchange == "" {
		rabbitmqExchange = "geopicto.events"
	}

	return &Config{
		Port:             port,
		DatabaseURL:      databaseURL,
		RabbitMQURL:      rabbitmqURL,
		RabbitMQExchange: rabbitmqExchange,
	}, nil
}
