package config

import (
	"fmt"
	"os"
)

type Config struct {
	DatabaseURL string
	Port        string
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

	return &Config{
		DatabaseURL: databaseURL,
		Port:        port,
	}, nil
}