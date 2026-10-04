package repository

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"messages/internal/domain"
)

type MessageRepository interface {
	Create(ctx context.Context, message *domain.Message) (*domain.Message, error)
	//Update(ctx context.Context, id uuid.UUID, message *domain.Message) (*domain.Message, error)
	Delete(ctx context.Context, id uuid.UUID, sender_id uuid.UUID) (error)
	GetByID(ctx context.Context, id uuid.UUID, sender_id uuid.UUID) 	(*domain.Message, error)
	GetNearby(ctx context.Context,latitude float64, longitude float64, radius float64) ([]*domain.Message,error)
}

type postgresMessageRepository struct {
	db *pgxpool.Pool
}

func NewPostgresMessageRepository(db *pgxpool.Pool) MessageRepository {
	return &postgresMessageRepository{
		db: db,
	}
}

func (r *postgresMessageRepository) Create(
	ctx context.Context,
	message *domain.Message,
) (*domain.Message, error) {

	query := `
		INSERT INTO messages (
			sender_id,
			content,
			location
		)
		VALUES (
			$1,
			$2,
			ST_SetSRID(
				ST_MakePoint($3, $4),
				4326
			)::geography
		)
		RETURNING
			id,
			sender_id,
			content,
			ST_Y(location::geometry) AS latitude,
    		ST_X(location::geometry) AS longitude,
			created_at
	`

	var msg domain.Message

	err := r.db.QueryRow(
		ctx,
		query,
		message.SenderID,
		message.Content,
		message.Location.Longitude,
		message.Location.Latitude,
	).Scan(
		&msg.ID,
		&msg.SenderID,
		&msg.Content,
		&msg.Location.Latitude,
		&msg.Location.Longitude,
		&msg.CreatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("error creating message: %w", err)
	}

	return &msg, nil
}

func (r *postgresMessageRepository) Delete(
    ctx context.Context,
    messageID uuid.UUID,
    userID uuid.UUID,
) error {

    query := `
        DELETE FROM messages
        WHERE id = $1
        AND sender_id = $2
    `

    result, err := r.db.Exec(
        ctx,
        query,
        messageID,
        userID,
    )

    if err != nil {
        return fmt.Errorf("error deleting message: %w", err)
    }

    if result.RowsAffected() == 0 {
        return fmt.Errorf("message not found or user is not the owner")
    }

    return nil
}


func (r *postgresMessageRepository) GetByID(
	ctx context.Context,
	id uuid.UUID,
	sender_id uuid.UUID,
) (*domain.Message, error) {

	query := `
		SELECT
			id,
			sender_id,
			content,
			ST_Y(location::geometry) AS latitude,
			ST_X(location::geometry) AS longitude,
			created_at
		FROM messages
		WHERE id = $1 AND sender_id = $2
	`

	message := &domain.Message{}

	err := r.db.QueryRow(
		ctx,
		query,
		id,
		sender_id,
	).Scan(
		&message.ID,
		&message.SenderID,
		&message.Content,
		&message.Location.Latitude,
		&message.Location.Longitude,
		&message.CreatedAt,
	)

	if err != nil {
		return nil, fmt.Errorf("error getting message: %w", err)
	}

	return message, nil
}


func (r *postgresMessageRepository) GetNearby(
	ctx context.Context,
	latitude float64,
	longitude float64,
	radius float64,
) ([]*domain.Message, error) {

	query := `
		WITH point AS (
			SELECT ST_SetSRID(
				ST_MakePoint($1, $2),
				4326
			)::geography AS location
		)
		SELECT
			m.id,
			m.sender_id,
			m.content,
			ST_Y(m.location::geometry) AS latitude,
			ST_X(m.location::geometry) AS longitude,
			m.created_at
		FROM messages m, point p
		WHERE ST_DWithin(m.location, p.location, $3)
		ORDER BY ST_Distance(m.location, p.location);
	`

	rows, err := r.db.Query(
		ctx,
		query,
		longitude,
		latitude,
		radius,
	)

	if err != nil {
		return nil, fmt.Errorf("error getting nearby messages: %w", err)
	}

	defer rows.Close()

	var messages []*domain.Message

	for rows.Next() {

		message := &domain.Message{}

		err := rows.Scan(
			&message.ID,
			&message.SenderID,
			&message.Content,
			&message.Location.Latitude,
			&message.Location.Longitude,
			&message.CreatedAt,
		)

		if err != nil {
			return nil, fmt.Errorf("error scanning message: %w", err)
		}

		messages = append(messages, message)
	}

	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("error iterating messages: %w", err)
	}

	return messages, nil
}