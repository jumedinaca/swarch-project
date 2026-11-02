package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	testSecret = "test-secret-for-messages-jwt-middleware-0123456789"
	testIssuer = "geopicto-auth"
)

func signToken(t *testing.T, subject string, issuer string, expiration time.Time) string {
	t.Helper()

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.MapClaims{
		"sub": subject,
		"iss": issuer,
		"iat": time.Now().Add(-time.Minute).Unix(),
		"exp": expiration.Unix(),
	})

	signed, err := token.SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("failed to sign token: %v", err)
	}
	return signed
}

func TestJWTAuthRejectsMissingToken(t *testing.T) {
	handler := JWTAuth(testSecret, testIssuer, 0)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/messages", nil))

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestJWTAuthRejectsInvalidToken(t *testing.T) {
	handler := JWTAuth(testSecret, testIssuer, 0)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodPost, "/messages", nil)
	req.Header.Set("Authorization", "Bearer not-a-jwt")

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}

func TestJWTAuthInjectsUserID(t *testing.T) {
	userID := uuid.New()
	token := signToken(t, userID.String(), testIssuer, time.Now().Add(time.Hour))

	var got uuid.UUID
	handler := JWTAuth(testSecret, testIssuer, 0)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		value, ok := UserIDFromContext(r.Context())
		if !ok {
			t.Fatal("user id missing from context")
		}
		got = value
		w.WriteHeader(http.StatusNoContent)
	}))

	req := httptest.NewRequest(http.MethodPost, "/messages", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want 204", rec.Code)
	}
	if got != userID {
		t.Fatalf("user id = %s, want %s", got, userID)
	}
}

func TestJWTAuthRejectsExpiredToken(t *testing.T) {
	token := signToken(t, uuid.New().String(), testIssuer, time.Now().Add(-time.Hour))

	handler := JWTAuth(testSecret, testIssuer, 0)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("handler should not be called")
	}))

	req := httptest.NewRequest(http.MethodPost, "/messages", nil)
	req.Header.Set("Authorization", "Bearer "+token)

	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rec.Code)
	}
}
