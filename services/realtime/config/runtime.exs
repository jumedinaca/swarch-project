import Config

if config_env() != :test do
  config :realtime,
    port: String.to_integer(System.get_env("PORT", "8080")),
    redis_url: System.get_env("REDIS_URL", "redis://redis:6379/0"),
    rabbitmq_url:
      System.get_env("RABBITMQ_URL", "amqp://geopicto:geopicto@rabbitmq:5672/geopicto"),
    rabbitmq_exchange: System.get_env("RABBITMQ_EXCHANGE", "geopicto.events"),
    rabbitmq_queue: System.get_env("RABBITMQ_QUEUE", "socket.events.q"),
    redis_pubsub_channel: System.get_env("REDIS_PUBSUB_CHANNEL", "geopicto:realtime"),
    ticket_ttl_seconds: String.to_integer(System.get_env("TICKET_TTL_SECONDS", "60")),
    presence_ttl_seconds: String.to_integer(System.get_env("PRESENCE_TTL_SECONDS", "60")),
    max_connections_per_user: String.to_integer(System.get_env("MAX_CONNECTIONS_PER_USER", "5")),
    rate_limit_per_second: String.to_integer(System.get_env("RATE_LIMIT_PER_SECOND", "10")),
    heartbeat_interval_ms: String.to_integer(System.get_env("HEARTBEAT_INTERVAL_MS", "30000")),
    heartbeat_timeout_ms: String.to_integer(System.get_env("HEARTBEAT_TIMEOUT_MS", "90000")),
    max_frame_size: String.to_integer(System.get_env("MAX_FRAME_SIZE", "16384")),
    max_buffer_size: String.to_integer(System.get_env("MAX_BUFFER_SIZE", "100")),
    ws_allowed_origins: System.get_env("WS_ALLOWED_ORIGINS", "http://localhost:8081,http://localhost:8082,http://localhost:8080,http://127.0.0.1:8081,http://127.0.0.1:8082,http://127.0.0.1:8080"),
    internal_token: System.get_env("INTERNAL_TOKEN", "dev-internal-token"),
    app_env: System.get_env("APP_ENV", "production"),
    allow_dev_token_fallback: System.get_env("ALLOW_DEV_TOKEN_FALLBACK", "false") == "true"
end
