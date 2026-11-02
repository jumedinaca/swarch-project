defmodule Realtime.Dispatcher do
  @moduledoc """
  Registro y despacho local de eventos a procesos WebSocket mediante OTP `Registry`.
  - `Realtime.TopicRegistry`: mapea `topic -> [pid]`
  - `Realtime.UserRegistry`: mapea `user_id -> [pid]` (control de límite de conexiones por usuario)
  """

  alias Realtime.Metrics

  @topic_registry Realtime.TopicRegistry
  @user_registry Realtime.UserRegistry

  def topic_registry_name, do: @topic_registry
  def user_registry_name, do: @user_registry

  @doc """
  Registra el proceso actual como una conexión activa de `user_id`.
  """
  def register_user_connection(user_id, connection_id) do
    Registry.register(@user_registry, normalize_user_id(user_id), connection_id)
  end

  @doc """
  Retorna la cantidad de conexiones locales activas para `user_id`.
  """
  def count_user_connections(user_id) do
    @user_registry
    |> Registry.lookup(normalize_user_id(user_id))
    |> length()
  end

  @doc """
  Suscribe el proceso WebSocket actual a `topic` (idempotente por PID).
  """
  def subscribe(topic) when is_binary(topic) do
    already_subscribed? =
      @topic_registry
      |> Registry.lookup(topic)
      |> Enum.any?(fn {pid, _} -> pid == self() end)

    if already_subscribed? do
      :ok
    else
      {:ok, _} = Registry.register(@topic_registry, topic, true)
      :ok
    end
  end

  @doc """
  Desuscribe el proceso WebSocket actual de `topic`.
  """
  def unsubscribe(topic) when is_binary(topic) do
    Registry.unregister(@topic_registry, topic)
  end

  @doc """
  Empuja un frame JSON codificado a todos los clientes locales suscritos a cualquiera de `topics`,
  sin enviar dos veces al mismo PID si un cliente está suscrito a dos tópicos del mismo evento
  (ej. `global` y `user:<authorId>`).
  """
  def broadcast_local(topics, frame_map) when is_list(topics) and is_map(frame_map) do
    encoded = Jason.encode!(frame_map)

    pids =
      topics
      |> Enum.flat_map(fn topic ->
        Registry.lookup(@topic_registry, topic)
        |> Enum.map(fn {pid, _} -> pid end)
      end)
      |> Enum.uniq()

    Enum.each(pids, fn pid ->
      send(pid, {:push_event, encoded})
      Metrics.inc(:events_pushed_total)
    end)

    {:ok, length(pids)}
  end

  defp normalize_user_id(user_id) when is_binary(user_id) do
    user_id |> String.trim() |> String.downcase()
  end
end
