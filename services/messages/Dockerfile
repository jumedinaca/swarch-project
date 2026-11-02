FROM golang:1.27.1-alpine AS development

WORKDIR /app

RUN go install github.com/air-verse/air@latest

COPY . .

RUN go mod download

EXPOSE 8080

CMD ["air", "-c", ".air.toml"]

FROM golang:1.27.1-alpine AS build

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux go build \
    -trimpath \
    -ldflags="-s -w" \
    -o /app/bin/messages \
    ./cmd/api

FROM alpine:3.22 AS production

WORKDIR /app

RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S app \
    && adduser -S -G app -u 1000 app

COPY --from=build /app/bin/messages /app/messages

USER app

EXPOSE 8080

CMD ["/app/messages"]
