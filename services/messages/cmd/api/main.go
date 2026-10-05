package main

import (
	"net/http"
	"log"
	"context"

	"messages/internal/config"
	"messages/internal/repository"
	"messages/internal/service"
	"messages/internal/handler"
	"messages/db"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatal(err)
	}

	// Database

	// Migrate
	if err := db.RunMigrations(cfg.DatabaseURL); err != nil {
		log.Fatalf("Fallo en migraciones: %v", err)
	}
	
	// Connect
	db, err := repository.NewDatabase(
		ctx,
		cfg.DatabaseURL,
	)
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()

	// Repository
	messageRepository := repository.NewPostgresMessageRepository(db)
	// Service
	messageService := service.NewMessageService(messageRepository)
	// Handler
	messageHandler := handler.NewMessageHandler(messageService)

	// Router
	mux := http.NewServeMux()

	mux.HandleFunc(
		"POST /messages",
		messageHandler.CreateMessage,
	)

	mux.HandleFunc(
		"GET /messages/{id}",
		messageHandler.GetMessageById,
	)

	mux.HandleFunc(
		"DELETE /messages/{id}",
		messageHandler.DeleteMessage,
	)

	mux.HandleFunc(
		"GET /messages/nearby",
		messageHandler.GetNearbyMessages,
	)
	
	log.Println("Server running on :" + cfg.Port)

	err = http.ListenAndServe(
		":"+cfg.Port,
		mux,
	)

	if err != nil {
		log.Fatal(err)
	}

}