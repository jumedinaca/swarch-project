# Etapa 1: compila el servicio y la herramienta simulate-message.
FROM golang:1.27.1-alpine AS builder

WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/rating ./cmd/api \
 && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/simulate-message ./cmd/simulate-message

# Etapa 2: imagen minima de ejecucion (wget de busybox para el healthcheck).
FROM alpine:3.22

RUN adduser -D -H -u 10001 app
COPY --from=builder /out/ /usr/local/bin/
USER app

EXPOSE 8080

HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:8080/health || exit 1

CMD ["rating"]
