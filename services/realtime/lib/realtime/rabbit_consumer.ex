defmodule Realtime.RabbitConsumer do
  @moduledoc """
  Consumidor resiliente de RabbitMQ para la cola `socket.events.q`.
  - Declara el exchange topic `geopicto.events` (durable) y la cola `socket.events.q` (durable).
  - Enlaza todas las routing keys de eventos del sistema.
  - Si RabbitMQ no está disponible al arrancar o se reinicia, reintenta con backoff exponencial
    (1 s hasta 30 s) sin detener el servicio WebSocket.
  """

  use GenServer
  require Logger

  alias Realtime.{Config, EventRouter, Metrics, Redis}

  @initial_backoff_ms 1_000
  @max_backoff_ms 30_000

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Indica si la conexión con RabbitMQ está establecida y saludable.
  """
  @spec healthy?() :: boolean()
  def healthy? do
    cond do
      Application.get_env(:realtime, :force_rabbitmq_down, false) ->
        false

      Application.get_env(:realtime, :mock_rabbitmq_healthy, false) ->
        true

      Process.whereis(__MODULE__) == nil ->
        false

      true ->
        try do
          GenServer.call(__MODULE__, :healthy?, 1_500)
        catch
          :exit, _ -> false
        end
    end
  end

  @doc """
  Procesa un mensaje crudo (JSON string o mapa) tal como si llegara desde `socket.events.q`.
  Reutilizado también por `POST /internal/publish` y las pruebas automatizadas.
  """
  @spec handle_raw_payload(String.t() | map()) ::
          {:ok, [String.t()], map()} | {:error, atom()}
  def handle_raw_payload(raw_json) when is_binary(raw_json) do
    case Jason.decode(raw_json) do
      {:ok, decoded} when is_map(decoded) ->
        handle_raw_payload(decoded)

      _ ->
        Metrics.inc(:events_dropped_total)
        Logger.warning("Dropping non-JSON payload from broker")
        {:error, :invalid_json}
    end
  end

  def handle_raw_payload(decoded) when is_map(decoded) do
    Metrics.inc(:events_received_total)

    case EventRouter.route_event(decoded) do
      {:ok, topics, frame_map} ->
        Redis.publish_fanout(topics, frame_map)
        {:ok, topics, frame_map}

      {:error, reason} ->
        Metrics.inc(:events_dropped_total)
        {:error, reason}
    end
  end

  # ==========================================
  # GenServer Callbacks
  # ==========================================

  @impl true
  def init(opts) do
    enabled? = Keyword.get(opts, :enabled, true)

    state = %{
      conn: nil,
      chan: nil,
      connected: false,
      backoff_ms: @initial_backoff_ms,
      enabled: enabled?
    }

    if enabled? do
      send(self(), :connect)
    end

    {:ok, state}
  end

  @impl true
  def handle_call(:healthy?, _from, state) do
    {:reply, state.connected == true, state}
  end

  @impl true
  def handle_info(:connect, %{enabled: false} = state), do: {:noreply, state}

  @impl true
  def handle_info(:connect, state) do
    url = Config.rabbitmq_url()
    exchange = Config.rabbitmq_exchange()
    queue = Config.rabbitmq_queue()

    case establish_consumer(url, exchange, queue) do
      {:ok, conn, chan} ->
        Process.monitor(conn.pid)
        Logger.info("Connected to RabbitMQ exchange=#{exchange} queue=#{queue}")

        {:noreply,
         %{state | conn: conn, chan: chan, connected: true, backoff_ms: @initial_backoff_ms}}

      {:error, reason} ->
        next_backoff = min(state.backoff_ms * 2, @max_backoff_ms)

        Logger.warning(
          "RabbitMQ unavailable (#{inspect(reason)}), retrying in #{state.backoff_ms}ms"
        )

        Process.send_after(self(), :connect, state.backoff_ms)
        {:noreply, %{state | conn: nil, chan: nil, connected: false, backoff_ms: next_backoff}}
    end
  end

  @impl true
  def handle_info({:basic_consume_ok, %{consumer_tag: _tag}}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:basic_cancel, %{consumer_tag: _tag}}, state) do
    Logger.warning("RabbitMQ consumer cancelled by broker, reconnecting")
    Process.send_after(self(), :connect, @initial_backoff_ms)
    {:noreply, %{state | connected: false}}
  end

  @impl true
  def handle_info({:basic_cancel_ok, %{consumer_tag: _tag}}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info({:basic_deliver, payload, %{delivery_tag: tag, routing_key: routing_key}}, state) do
    # Si el sobre JSON no trae "eventType"/"event", usamos la routing_key del mensaje AMQP
    result =
      case Jason.decode(payload) do
        {:ok, map} when is_map(map) ->
          enriched =
            if Map.has_key?(map, "event") or Map.has_key?(map, "eventType") do
              map
            else
              Map.put(map, "eventType", routing_key)
            end

          handle_raw_payload(enriched)

        _ ->
          Metrics.inc(:events_dropped_total)
          Logger.warning("Invalid JSON on queue #{Config.rabbitmq_queue()}, dropping message")
          {:error, :invalid_json}
      end

    if state.chan do
      case result do
        {:ok, _topics, _frame} ->
          _ = AMQP.Basic.ack(state.chan, tag)

        {:error, _reason} ->
          # Evento mal formado o sin userId/messageId: nack sin reencolar para no bloquear la cola
          _ = AMQP.Basic.nack(state.chan, tag, multiple: false, requeue: false)
      end
    end

    {:noreply, state}
  end

  @impl true
  def handle_info({:DOWN, _ref, :process, _pid, reason}, state) do
    Logger.warning("RabbitMQ connection lost (#{inspect(reason)}), scheduling reconnect")
    Process.send_after(self(), :connect, state.backoff_ms)
    {:noreply, %{state | conn: nil, chan: nil, connected: false}}
  end

  @impl true
  def handle_info(_other, state), do: {:noreply, state}

  # ==========================================
  # Setup AMQP
  # ==========================================

  defp establish_consumer(url, exchange, queue) do
    with {:ok, conn} <- AMQP.Connection.open(url),
         {:ok, chan} <- AMQP.Channel.open(conn),
         :ok <- AMQP.Exchange.declare(chan, exchange, :topic, durable: true),
         {:ok, _} <- AMQP.Queue.declare(chan, queue, durable: true),
         :ok <- bind_routing_keys(chan, queue, exchange),
         :ok <- AMQP.Basic.qos(chan, prefetch_count: 50),
         {:ok, _consumer_tag} <- AMQP.Basic.consume(chan, queue) do
      {:ok, conn, chan}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  defp bind_routing_keys(chan, queue, exchange) do
    Enum.reduce_while(EventRouter.supported_events(), :ok, fn routing_key, :ok ->
      case AMQP.Queue.bind(chan, queue, exchange, routing_key: routing_key) do
        :ok -> {:cont, :ok}
        {:error, reason} -> {:halt, {:error, reason}}
      end
    end)
  end
end
