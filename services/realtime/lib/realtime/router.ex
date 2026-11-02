defmodule Realtime.Router do
  @moduledoc """
  Router HTTP y Handshake WebSocket del servicio Realtime (`socket-gateway`):
  - `POST /tickets`: emite un ticket efímero de 60 s en Redis a partir de `X-User-ID`.
  - `GET /ws?ticket=`: valida y consume el ticket efímero e inicia la sesión WebSocket.
  - `GET /health`: reporta estado de conexiones, Redis (`503` si cae) y RabbitMQ (`degraded` si cae).
  - `GET /metrics`: métricas en formato Prometheus.
  - `POST /internal/publish`: endpoint protegido por `X-Internal-Token` para pruebas de integración.
  """

  use Plug.Router
  require Logger

  alias Realtime.{Config, Dispatcher, EventRouter, Metrics, RabbitConsumer, Redis, WsSocket}

  plug :match
  plug :dispatch

  # ---------------------------------------------------------------------------
  # POST /tickets
  # ---------------------------------------------------------------------------
  post "/tickets" do
    user_id =
      conn
      |> get_req_header("x-user-id")
      |> List.first()
      |> case do
        val when is_binary(val) -> String.trim(val)
        _ -> ""
      end

    cond do
      user_id == "" ->
        send_json(conn, 401, %{
          "error" => "unauthorized",
          "message" => "Missing X-User-ID header"
        })

      not Redis.healthy?() ->
        send_json(conn, 503, %{
          "error" => "service_unavailable",
          "message" => "Ticket store is unavailable"
        })

      true ->
        case Redis.issue_ticket(user_id) do
          {:ok, ticket, expires_in} ->
            send_json(conn, 200, %{
              "ticket" => ticket,
              "expiresIn" => expires_in
            })

          {:error, :redis_unavailable} ->
            send_json(conn, 503, %{
              "error" => "service_unavailable",
              "message" => "Ticket store is unavailable"
            })
        end
    end
  end

  # ---------------------------------------------------------------------------
  # GET /ws?ticket=<ticket>
  # ---------------------------------------------------------------------------
  get "/ws" do
    conn = fetch_query_params(conn)
    origin = get_req_header(conn, "origin") |> List.first()

    if not EventRouter.valid_origin?(origin, Config.ws_allowed_origins()) do
      Logger.warning(
        "WS handshake rejected due to invalid origin: #{inspect(origin)}, allowed: #{inspect(Config.ws_allowed_origins())}"
      )

      send_json(conn, 403, %{
        "error" => "forbidden_origin",
        "message" => "Origin is not allowed"
      })
    else
      if not Redis.healthy?() do
        upgrade_or_reject(conn, {:reject, 1013, "Service unavailable"}, 503, %{
          "error" => "service_unavailable",
          "message" => "Redis is unavailable"
        })
      else
        case authenticate_ws_handshake(conn.query_params) do
          {:ok, user_id} ->
            if Dispatcher.count_user_connections(user_id) >= Config.max_connections_per_user() do
              upgrade_or_reject(
                conn,
                {:reject, 1013, "Maximum connections per user reached"},
                429,
                %{
                  "error" => "too_many_connections",
                  "message" => "Máximo de 5 conexiones simultáneas alcanzado"
                }
              )
            else
              conn_id = "c-" <> Base.encode16(:crypto.strong_rand_bytes(6), case: :lower)

              WebSockAdapter.upgrade(
                conn,
                WsSocket,
                %{user_id: user_id, connection_id: conn_id},
                timeout: Config.heartbeat_timeout_ms(),
                max_frame_size: Config.max_frame_size()
              )
            end

          {:error, :redis_unavailable} ->
            upgrade_or_reject(conn, {:reject, 1013, "Service unavailable"}, 503, %{
              "error" => "service_unavailable",
              "message" => "Redis is unavailable"
            })

          {:error, :invalid_or_expired} ->
            upgrade_or_reject(conn, {:reject, 4401, "Invalid or expired ticket"}, 401, %{
              "error" => "invalid_ticket",
              "message" => "Ticket inválido o expirado"
            })
        end
      end
    end
  end

  # ---------------------------------------------------------------------------
  # GET /health
  # ---------------------------------------------------------------------------
  get "/health" do
    redis_ok = Redis.healthy?()
    rabbit_ok = RabbitConsumer.healthy?()
    connections = Metrics.get(:active_connections)

    cond do
      not redis_ok ->
        send_json(conn, 503, %{
          "status" => "unavailable",
          "connections" => connections,
          "redis" => "down",
          "rabbitmq" => if(rabbit_ok, do: "up", else: "down")
        })

      not rabbit_ok ->
        send_json(conn, 200, %{
          "status" => "degraded",
          "connections" => connections,
          "redis" => "up",
          "rabbitmq" => "down"
        })

      true ->
        send_json(conn, 200, %{
          "status" => "ok",
          "connections" => connections,
          "redis" => "up",
          "rabbitmq" => "up"
        })
    end
  end

  # ---------------------------------------------------------------------------
  # GET /metrics
  # ---------------------------------------------------------------------------
  get "/metrics" do
    body = Metrics.prometheus_text()

    conn
    |> put_resp_content_type("text/plain; version=0.0.4")
    |> send_resp(200, body)
  end

  # ---------------------------------------------------------------------------
  # POST /internal/publish (Solo pruebas / diagnóstico interno)
  # ---------------------------------------------------------------------------
  post "/internal/publish" do
    provided_token =
      conn
      |> get_req_header("x-internal-token")
      |> List.first()
      |> to_string()

    expected_token = Config.internal_token()

    if expected_token == "" or not Plug.Crypto.secure_compare(provided_token, expected_token) do
      send_json(conn, 401, %{
        "error" => "unauthorized",
        "message" => "Invalid or missing X-Internal-Token"
      })
    else
      {:ok, raw_body, conn} = read_body(conn, length: 65_536)

      case RabbitConsumer.handle_raw_payload(raw_body) do
        {:ok, topics, frame} ->
          send_json(conn, 202, %{
            "published" => true,
            "topics" => topics,
            "eventId" => frame["eventId"],
            "event" => frame["event"]
          })

        {:error, reason} ->
          send_json(conn, 422, %{
            "error" => to_string(reason),
            "message" => "No se pudo publicar el evento de prueba"
          })
      end
    end
  end

  match _ do
    send_json(conn, 404, %{
      "error" => "not_found",
      "message" => "Route not found"
    })
  end

  # ==========================================
  # Helpers Privados
  # ==========================================

  defp authenticate_ws_handshake(params) do
    case Map.get(params, "ticket") do
      ticket when is_binary(ticket) and ticket != "" ->
        Redis.consume_ticket(ticket)

      _ ->
        # Fallback documentado solo para entorno de desarrollo si está explícitamente habilitado
        if Config.allow_dev_token_fallback?() do
          case Map.get(params, "devUserId") || Map.get(params, "token") do
            dev_user when is_binary(dev_user) and dev_user != "" -> {:ok, dev_user}
            _ -> {:error, :invalid_or_expired}
          end
        else
          {:error, :invalid_or_expired}
        end
    end
  end

  defp upgrade_or_reject(conn, ws_reject_tuple, http_status, http_error_body) do
    upgrade_header =
      conn
      |> get_req_header("upgrade")
      |> List.first()
      |> to_string()
      |> String.downcase()

    if upgrade_header == "websocket" do
      WebSockAdapter.upgrade(conn, WsSocket, ws_reject_tuple, timeout: 5_000)
    else
      send_json(conn, http_status, http_error_body)
    end
  end

  defp send_json(conn, status, map) do
    body = Jason.encode!(map)

    conn
    |> put_resp_content_type("application/json")
    |> send_resp(status, body)
  end
end
