defmodule Realtime.WsSocket do
  @moduledoc """
  Implementación del protocolo WebSocket (`@behaviour WebSock`) para GeoPicto:
  - Envía frame inicial `ready` al autenticar el ticket efímero.
  - Procesa `subscribe`, `unsubscribe` y `ping`.
  - Aplica autorización de tópicos (`user:<propio_id>`, `message:<id>`, `global`).
  - Rate limit: máximo 10 mensajes/segundo por conexión (`4429`).
  - Heartbeat cada 30 s y desconexión por inactividad a los 90 s (`4408`).
  - Backpressure: si el buzón del proceso supera `MAX_BUFFER_SIZE`, cierra la conexión (`1013`)
    sin bloquear al servidor.
  """

  @behaviour WebSock
  require Logger

  alias Realtime.{Config, Dispatcher, EventRouter, Metrics, Redis}

  @impl true
  def init({:reject, close_code, reason}) do
    state = %{rejected: true, close_code: close_code, reason: reason, user_id: nil}
    send(self(), :close_rejected)
    {:ok, state}
  end

  @impl true
  def init(%{user_id: user_id, connection_id: conn_id}) do
    Logger.metadata(connection_id: conn_id, user_id: user_id)
    Dispatcher.register_user_connection(user_id, conn_id)
    Metrics.inc(:active_connections)
    Redis.touch_presence(user_id, conn_id)

    now = System.monotonic_time(:millisecond)
    schedule_heartbeat()

    state = %{
      rejected: false,
      user_id: user_id,
      connection_id: conn_id,
      topics: MapSet.new(),
      location: nil,
      last_seen_ms: now,
      window_start_ms: now,
      msg_count_in_window: 0
    }

    ready_frame =
      Jason.encode!(%{
        "type" => "ready",
        "connectionId" => conn_id,
        "userId" => user_id
      })

    {:push, {:text, ready_frame}, state}
  end

  @impl true
  def handle_in({text, [opcode: :text]}, %{rejected: false} = state) do
    now = System.monotonic_time(:millisecond)
    state = %{state | last_seen_ms: now}

    cond do
      byte_size(text) > Config.max_frame_size() ->
        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "frame_too_large",
            "message" => "El mensaje supera el límite de 16 KB"
          })

        {:stop, :normal, {1009, "Frame too large"}, [{:text, err}], state}

      rate_limited?(state, now) ->
        Metrics.inc(:rate_limited_total)

        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "rate_limited",
            "message" => "Límite de mensajes por segundo excedido"
          })

        {:stop, :normal, {4429, "Rate limit exceeded"}, [{:text, err}], state}

      true ->
        state = bump_rate_window(state, now)
        handle_client_json(text, state)
    end
  end

  @impl true
  def handle_in(_other, state) do
    {:ok, state}
  end

  @impl true
  def handle_control({_payload, [opcode: :pong]}, %{rejected: false} = state) do
    now = System.monotonic_time(:millisecond)
    Redis.touch_presence(state.user_id, state.connection_id)
    {:ok, %{state | last_seen_ms: now}}
  end

  @impl true
  def handle_control({_payload, [opcode: :ping]}, state) do
    now = System.monotonic_time(:millisecond)
    {:ok, %{state | last_seen_ms: now}}
  end

  @impl true
  def handle_info(:close_rejected, %{rejected: true} = state) do
    {:stop, :normal, {state.close_code, state.reason}, state}
  end

  @impl true
  def handle_info({:push_event, encoded_json}, %{rejected: false} = state) do
    {:message_queue_len, queue_len} = Process.info(self(), :message_queue_len)

    cond do
      queue_len > Config.max_buffer_size() ->
        Metrics.inc(:events_dropped_total)
        Logger.warning("Closing slow WebSocket connection due to backpressure")
        {:stop, :normal, {1013, "Backpressure buffer full"}, state}

      not should_deliver_to_socket?(encoded_json, state) ->
        {:ok, state}

      true ->
        {:push, {:text, encoded_json}, state}
    end
  end

  @impl true
  def handle_info(:heartbeat_check, %{rejected: false} = state) do
    now = System.monotonic_time(:millisecond)
    timeout_ms = Config.heartbeat_timeout_ms()

    if now - state.last_seen_ms > timeout_ms do
      Logger.info("Closing inactive WebSocket connection after #{timeout_ms}ms")
      {:stop, :normal, {4408, "Heartbeat timeout"}, state}
    else
      Redis.touch_presence(state.user_id, state.connection_id)
      schedule_heartbeat()
      {:push, {:ping, ""}, state}
    end
  end

  @impl true
  def handle_info(_other, state), do: {:ok, state}

  @impl true
  def terminate(_reason, %{rejected: false, user_id: user_id, connection_id: conn_id}) do
    Metrics.dec(:active_connections)
    Redis.clear_presence(user_id, conn_id)
    :ok
  end

  @impl true
  def terminate(_reason, _state), do: :ok

  # ==========================================
  # Procesamiento de Mensajes JSON del Cliente
  # ==========================================

  defp handle_client_json(text, state) do
    case Jason.decode(text) do
      {:ok, %{"type" => "ping"} = msg} ->
        ts = Map.get(msg, "ts", System.system_time(:millisecond))
        Redis.touch_presence(state.user_id, state.connection_id)
        pong = Jason.encode!(%{"type" => "pong", "ts" => ts})
        {:push, {:text, pong}, state}

      {:ok, %{"type" => "subscribe", "topics" => topics}} when is_list(topics) ->
        handle_subscribe(topics, state)

      {:ok, %{"type" => "unsubscribe", "topics" => topics}} when is_list(topics) ->
        handle_unsubscribe(topics, state)

      {:ok,
       %{
         "type" => "set_location",
         "latitude" => lat,
         "longitude" => lon,
         "radiusMeters" => radius
       }}
      when is_number(lat) and is_number(lon) and is_number(radius) and radius > 0 ->
        new_loc = %{lat: lat * 1.0, lon: lon * 1.0, radius: radius * 1.0}
        {:ok, %{state | location: new_loc}}

      {:ok, _} ->
        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "invalid_message",
            "message" => "Tipo de mensaje o estructura no soportada"
          })

        {:push, {:text, err}, state}

      {:error, _} ->
        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "invalid_json",
            "message" => "El mensaje debe ser JSON válido"
          })

        {:push, {:text, err}, state}
    end
  end

  defp handle_subscribe(topics, state) do
    {allowed, errors} =
      Enum.reduce(topics, {[], []}, fn topic, {acc_ok, acc_err} ->
        if is_binary(topic) do
          case EventRouter.authorize_topic(topic, state.user_id) do
            :ok -> {[topic | acc_ok], acc_err}
            {:error, reason} -> {acc_ok, [{topic, reason} | acc_err]}
          end
        else
          {acc_ok, [{inspect(topic), :invalid_topic} | acc_err]}
        end
      end)

    updated_topics =
      Enum.reduce(allowed, state.topics, fn topic, set ->
        Dispatcher.subscribe(topic)
        MapSet.put(set, topic)
      end)

    new_state = %{state | topics: updated_topics}

    case errors do
      [] ->
        {:ok, new_state}

      [{_topic, :forbidden_topic} | _] ->
        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "forbidden_topic",
            "message" => "No puedes suscribirte a ese tópico"
          })

        {:push, {:text, err}, new_state}

      _ ->
        err =
          Jason.encode!(%{
            "type" => "error",
            "code" => "invalid_topic",
            "message" => "Tópico inválido"
          })

        {:push, {:text, err}, new_state}
    end
  end

  defp handle_unsubscribe(topics, state) do
    updated_topics =
      Enum.reduce(topics, state.topics, fn topic, set ->
        if is_binary(topic) do
          Dispatcher.unsubscribe(topic)
          MapSet.delete(set, topic)
        else
          set
        end
      end)

    {:ok, %{state | topics: updated_topics}}
  end

  defp rate_limited?(state, now) do
    limit = Config.rate_limit_per_second()

    if now - state.window_start_ms < 1_000 do
      state.msg_count_in_window >= limit
    else
      false
    end
  end

  defp bump_rate_window(state, now) do
    if now - state.window_start_ms < 1_000 do
      %{state | msg_count_in_window: state.msg_count_in_window + 1}
    else
      %{state | window_start_ms: now, msg_count_in_window: 1}
    end
  end

  defp schedule_heartbeat do
    Process.send_after(self(), :heartbeat_check, Config.heartbeat_interval_ms())
  end

  # Filtra eventos geoespaciales (`message.published.v1`) en el servidor cuando el cliente
  # ha configurado su ubicación y rango de radar (`set_location`).
  defp should_deliver_to_socket?(_encoded_json, %{location: nil}), do: true

  defp should_deliver_to_socket?(encoded_json, %{
         location: %{lat: u_lat, lon: u_lon, radius: radius},
         user_id: user_id
       }) do
    case Jason.decode(encoded_json) do
      {:ok, %{"event" => "message.published.v1", "payload" => payload}} when is_map(payload) ->
        author_id = Map.get(payload, "authorId")
        m_lat = Map.get(payload, "latitude")
        m_lon = Map.get(payload, "longitude")

        cond do
          is_binary(author_id) and author_id == user_id ->
            true

          is_number(m_lat) and is_number(m_lon) ->
            haversine_meters(u_lat, u_lon, m_lat * 1.0, m_lon * 1.0) <= radius

          true ->
            true
        end

      _ ->
        true
    end
  end

  defp haversine_meters(lat1, lon1, lat2, lon2) do
    r = 6_371_000.0
    d_lat = (lat2 - lat1) * :math.pi() / 180.0
    d_lon = (lon2 - lon1) * :math.pi() / 180.0

    a =
      :math.sin(d_lat / 2.0) * :math.sin(d_lat / 2.0) +
        :math.cos(lat1 * :math.pi() / 180.0) *
          :math.cos(lat2 * :math.pi() / 180.0) *
          :math.sin(d_lon / 2.0) * :math.sin(d_lon / 2.0)

    c = 2.0 * :math.atan2(:math.sqrt(a), :math.sqrt(1.0 - a))
    r * c
  end
end
