defmodule Realtime.Redis do
  @moduledoc """
  Gestión de estado en Redis:
  - Tickets efímeros de un solo uso: `ticket:<ticket> -> userId` (TTL 60 s).
  - Presencia básica: `presence:<userId> -> connectionId` (TTL 60 s).
  - Canal Pub/Sub `geopicto:realtime` para fanout entre instancias.

  Nota de seguridad: Nunca se registran valores de tickets en logs.
  """

  use GenServer
  require Logger

  alias Realtime.{Config, Dispatcher, Metrics}

  @command_conn Realtime.Redix
  @pubsub_conn Realtime.Redix.PubSub
  @memory_table :realtime_memory_store

  def start_link(opts \\ []) do
    GenServer.start_link(__MODULE__, opts, name: __MODULE__)
  end

  @doc """
  Genera un ticket opaco de 32 bytes (URL-safe base64 sin padding) y lo guarda
  con TTL de 60 s asociado a `user_id`.
  """
  @spec issue_ticket(String.t()) :: {:ok, String.t(), pos_integer()} | {:error, :redis_unavailable}
  def issue_ticket(user_id) when is_binary(user_id) do
    ttl = Config.ticket_ttl_seconds()
    ticket = :crypto.strong_rand_bytes(32) |> Base.url_encode64(padding: false)
    key = "ticket:#{ticket}"

    case put_key_with_ttl(key, user_id, ttl) do
      :ok ->
        Metrics.inc(:tickets_issued_total)
        {:ok, ticket, ttl}

      {:error, _reason} ->
        {:error, :redis_unavailable}
    end
  end

  @doc """
  Valida y consume atómicamente (un solo uso) un ticket efímero.
  Retorna `{:ok, user_id}`, `{:error, :invalid_or_expired}` o `{:error, :redis_unavailable}`.
  """
  @spec consume_ticket(String.t() | nil) ::
          {:ok, String.t()} | {:error, :invalid_or_expired | :redis_unavailable}
  def consume_ticket(nil) do
    Metrics.inc(:tickets_rejected_total)
    {:error, :invalid_or_expired}
  end

  def consume_ticket(ticket) when is_binary(ticket) do
    trimmed = String.trim(ticket)

    if trimmed == "" do
      Metrics.inc(:tickets_rejected_total)
      {:error, :invalid_or_expired}
    else
      case get_and_delete("ticket:#{trimmed}") do
        {:ok, nil} ->
          Metrics.inc(:tickets_rejected_total)
          {:error, :invalid_or_expired}

        {:ok, user_id} when is_binary(user_id) ->
          Metrics.inc(:tickets_consumed_total)
          {:ok, user_id}

        {:error, :redis_unavailable} ->
          {:error, :redis_unavailable}
      end
    end
  end

  @doc """
  Actualiza la clave `presence:<userId> -> connectionId` con TTL de 60 s.
  """
  @spec touch_presence(String.t(), String.t()) :: :ok
  def touch_presence(user_id, connection_id) do
    ttl = Config.presence_ttl_seconds()
    _ = put_key_with_ttl("presence:#{user_id}", connection_id, ttl)
    :ok
  end

  @doc """
  Limpia la clave de presencia al cerrar la conexión.
  """
  @spec clear_presence(String.t(), String.t()) :: :ok
  def clear_presence(user_id, _connection_id) do
    _ = delete_key("presence:#{user_id}")
    :ok
  end

  @doc """
  Publica un evento en el canal Pub/Sub `geopicto:realtime` para fanout entre instancias.
  Si el Pub/Sub de Redis está activo, la instancia recibirá el mensaje por suscripción;
  si no está activo (modo test o fallo transitorio), despacha localmente para no perder entrega local.
  """
  @spec publish_fanout([String.t()], map()) :: :ok
  def publish_fanout(topics, frame_map) when is_list(topics) and is_map(frame_map) do
    envelope = Jason.encode!(%{"topics" => topics, "frame" => frame_map})
    channel = Config.redis_pubsub_channel()

    case use_memory_backend?() do
      true ->
        Dispatcher.broadcast_local(topics, frame_map)
        :ok

      false ->
        case Redix.command(@command_conn, ["PUBLISH", channel, envelope], timeout: 1_500) do
          {:ok, _subscribers} ->
            :ok

          {:error, _reason} ->
            Dispatcher.broadcast_local(topics, frame_map)
            :ok
        end
    end
  end

  @doc """
  Verifica si Redis responde a `PING`.
  """
  @spec healthy?() :: boolean()
  def healthy? do
    cond do
      Application.get_env(:realtime, :force_redis_down, false) ->
        false

      use_memory_backend?() ->
        true

      Process.whereis(@command_conn) == nil ->
        false

      true ->
        case Redix.command(@command_conn, ["PING"], timeout: 1_500) do
          {:ok, "PONG"} -> true
          _ -> false
        end
    end
  end

  # ==========================================
  # GenServer Callbacks (Suscriptor Pub/Sub)
  # ==========================================

  @impl true
  def init(_opts) do
    ensure_memory_table()

    if use_memory_backend?() do
      {:ok, %{pubsub_ref: nil}}
    else
      send(self(), :subscribe_pubsub)
      {:ok, %{pubsub_ref: nil}}
    end
  end

  @impl true
  def handle_info(:subscribe_pubsub, state) do
    channel = Config.redis_pubsub_channel()

    if Process.whereis(@pubsub_conn) do
      case Redix.PubSub.subscribe(@pubsub_conn, channel, self()) do
        {:ok, ref} ->
          Logger.info("Subscribed to Redis Pub/Sub channel #{channel}")
          {:noreply, %{state | pubsub_ref: ref}}

        {:error, reason} ->
          Logger.warning("Failed to subscribe to Redis Pub/Sub: #{inspect(reason)}")
          Process.send_after(self(), :subscribe_pubsub, 3_000)
          {:noreply, state}
      end
    else
      Process.send_after(self(), :subscribe_pubsub, 3_000)
      {:noreply, state}
    end
  end

  @impl true
  def handle_info({:redix_pubsub, _pubsub, _ref, :subscribed, _meta}, state) do
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:redix_pubsub, _pubsub, _ref, :disconnected, %{error: error}},
        state
      ) do
    Logger.warning("Redis Pub/Sub disconnected: #{inspect(error)}")
    {:noreply, state}
  end

  @impl true
  def handle_info(
        {:redix_pubsub, _pubsub, _ref, :message, %{payload: payload}},
        state
      ) do
    case Jason.decode(payload) do
      {:ok, %{"topics" => topics, "frame" => frame}} when is_list(topics) and is_map(frame) ->
        Dispatcher.broadcast_local(topics, frame)

      _ ->
        Logger.warning("Ignored malformed message on Redis Pub/Sub channel")
    end

    {:noreply, state}
  end

  @impl true
  def handle_info(_other, state), do: {:noreply, state}

  # ==========================================
  # Helpers Internos (Redix + Memory Store para Tests)
  # ==========================================

  defp use_memory_backend? do
    Application.get_env(:realtime, :use_memory_redis, false)
  end

  defp ensure_memory_table do
    case :ets.whereis(@memory_table) do
      :undefined ->
        :ets.new(@memory_table, [:named_table, :public, :set, {:read_concurrency, true}])

      _ ->
        :ok
    end
  end

  defp put_key_with_ttl(key, value, ttl_seconds) do
    cond do
      Application.get_env(:realtime, :force_redis_down, false) ->
        {:error, :redis_unavailable}

      use_memory_backend?() ->
        ensure_memory_table()
        expires_at = System.monotonic_time(:millisecond) + ttl_seconds * 1_000
        :ets.insert(@memory_table, {key, value, expires_at})
        :ok

      Process.whereis(@command_conn) == nil ->
        {:error, :redis_unavailable}

      true ->
        case Redix.command(
               @command_conn,
               ["SET", key, value, "EX", Integer.to_string(ttl_seconds)],
               timeout: 2_000
             ) do
          {:ok, "OK"} -> :ok
          {:error, reason} -> {:error, reason}
        end
    end
  end

  defp get_and_delete(key) do
    cond do
      Application.get_env(:realtime, :force_redis_down, false) ->
        {:error, :redis_unavailable}

      use_memory_backend?() ->
        ensure_memory_table()
        now = System.monotonic_time(:millisecond)

        case :ets.take(@memory_table, key) do
          [{^key, value, expires_at}] when expires_at > now -> {:ok, value}
          _ -> {:ok, nil}
        end

      Process.whereis(@command_conn) == nil ->
        {:error, :redis_unavailable}

      true ->
        case Redix.command(@command_conn, ["GETDEL", key], timeout: 2_000) do
          {:ok, value} ->
            {:ok, value}

          {:error, %Redix.Error{message: "ERR unknown command" <> _}} ->
            case Redix.pipeline(@command_conn, [["GET", key], ["DEL", key]], timeout: 2_000) do
              {:ok, [value, _]} -> {:ok, value}
              {:error, _} -> {:error, :redis_unavailable}
            end

          {:error, _reason} ->
            {:error, :redis_unavailable}
        end
    end
  end

  defp delete_key(key) do
    if use_memory_backend?() do
      ensure_memory_table()
      :ets.delete(@memory_table, key)
      :ok
    else
      if Process.whereis(@command_conn) do
        _ = Redix.command(@command_conn, ["DEL", key], timeout: 1_500)
      end

      :ok
    end
  end
end
