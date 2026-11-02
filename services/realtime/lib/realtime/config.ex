defmodule Realtime.Config do
  @moduledoc """
  Acceso centralizado a la configuración en tiempo de ejecución del servicio Realtime.
  """

  def port, do: Application.get_env(:realtime, :port, 8080)
  def redis_url, do: Application.get_env(:realtime, :redis_url, "redis://redis:6379/0")

  def rabbitmq_url,
    do:
      Application.get_env(
        :realtime,
        :rabbitmq_url,
        "amqp://geopicto:geopicto@rabbitmq:5672/geopicto"
      )

  def rabbitmq_exchange,
    do: Application.get_env(:realtime, :rabbitmq_exchange, "geopicto.events")

  def rabbitmq_queue,
    do: Application.get_env(:realtime, :rabbitmq_queue, "socket.events.q")

  def redis_pubsub_channel,
    do: Application.get_env(:realtime, :redis_pubsub_channel, "geopicto:realtime")

  def ticket_ttl_seconds, do: Application.get_env(:realtime, :ticket_ttl_seconds, 60)
  def presence_ttl_seconds, do: Application.get_env(:realtime, :presence_ttl_seconds, 60)
  def max_connections_per_user, do: Application.get_env(:realtime, :max_connections_per_user, 5)
  def rate_limit_per_second, do: Application.get_env(:realtime, :rate_limit_per_second, 10)
  def heartbeat_interval_ms, do: Application.get_env(:realtime, :heartbeat_interval_ms, 30_000)
  def heartbeat_timeout_ms, do: Application.get_env(:realtime, :heartbeat_timeout_ms, 90_000)
  def max_frame_size, do: Application.get_env(:realtime, :max_frame_size, 16_384)
  def max_buffer_size, do: Application.get_env(:realtime, :max_buffer_size, 100)

  def ws_allowed_origins do
    raw =
      Application.get_env(
        :realtime,
        :ws_allowed_origins,
        "http://localhost:8081,http://localhost:8080"
      )

    raw
    |> String.split(",", trim: true)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  def internal_token, do: Application.get_env(:realtime, :internal_token, "dev-internal-token")
  def app_env, do: Application.get_env(:realtime, :app_env, "production")

  def allow_dev_token_fallback?,
    do:
      Application.get_env(:realtime, :allow_dev_token_fallback, false) == true and
        app_env() == "development"
end
