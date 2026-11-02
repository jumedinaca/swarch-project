package middleware

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

type contextKey string

const userIDContextKey contextKey = "userID"

var (
	ErrMissingToken = errors.New("missing or invalid Authorization header")
	ErrInvalidToken = errors.New("invalid or expired token")
)

// JWTAuth exige un JWT HS256 válido en el header Authorization. Los servicios
// internos validan el token por su cuenta aunque la petición venga del gateway.
func JWTAuth(secret, issuer string, leeway time.Duration) func(http.Handler) http.Handler {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
		jwt.WithIssuer(issuer),
		jwt.WithLeeway(leeway),
		jwt.WithExpirationRequired(),
	)

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				http.Error(w, ErrMissingToken.Error(), http.StatusUnauthorized)
				return
			}

			rawToken := strings.TrimSpace(strings.TrimPrefix(header, "Bearer "))
			if rawToken == "" {
				http.Error(w, ErrMissingToken.Error(), http.StatusUnauthorized)
				return
			}

			claims := jwt.MapClaims{}
			token, err := parser.ParseWithClaims(rawToken, claims, func(_ *jwt.Token) (any, error) {
				return []byte(secret), nil
			})
			if err != nil || !token.Valid {
				http.Error(w, ErrInvalidToken.Error(), http.StatusUnauthorized)
				return
			}

			// Los tokens de auth incluyen type=access; los generados por
			// scripts/dev-token.mjs no lo traen, así que solo se valida si existe.
			if tokenType, ok := claims["type"].(string); ok && tokenType != "" && tokenType != "access" {
				http.Error(w, ErrInvalidToken.Error(), http.StatusUnauthorized)
				return
			}

			subject, err := claims.GetSubject()
			if err != nil || subject == "" {
				http.Error(w, ErrInvalidToken.Error(), http.StatusUnauthorized)
				return
			}

			userID, err := uuid.Parse(subject)
			if err != nil {
				http.Error(w, ErrInvalidToken.Error(), http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), userIDContextKey, userID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

func UserIDFromContext(ctx context.Context) (uuid.UUID, bool) {
	userID, ok := ctx.Value(userIDContextKey).(uuid.UUID)
	return userID, ok
}

// WithUserID permite inyectar el usuario en pruebas unitarias de handlers.
func WithUserID(ctx context.Context, userID uuid.UUID) context.Context {
	return context.WithValue(ctx, userIDContextKey, userID)
}
