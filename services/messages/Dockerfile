FROM golang:1.27.1-alpine

WORKDIR /app

RUN go install github.com/air-verse/air@latest

COPY . .

RUN go mod download

EXPOSE 8080

CMD ["air", "-c", ".air.toml"]