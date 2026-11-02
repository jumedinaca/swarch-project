defmodule Realtime.EventRouter do
  @moduledoc """
  Lógica pura de dominio del Socket Gateway:
  - Autorización de suscripción a tópicos (`user:<id>`, `message:<id>`, `global`).
  - Mapeo de eventos de RabbitMQ a tópicos destino.
  - Truncado de `contentPreview` a máximo 140 caracteres y eliminación de `content` completo.
  - Validación de `Origin` contra `WS_ALLOWED_ORIGINS`.
  """

  require Logger

  @max_preview_length 140

  @supported_events [
    "notification.requested.v1",
    "activity.created.v1",
    "reputation.changed.v1",
    "moderation.completed.v1",
    "rating.changed.v1",
    "message.published.v1",
    "message.deleted.v1",
    "profile.updated.v1"
  ]

  def supported_events, do: @supported_events

  @doc """
  Valida si un usuario autenticado `user_id` puede suscribirse a `topic`.
  Reglas:
  - `user:<id>` -> solo si `<id> == user_id`
  - `message:<id>` -> permitido para cualquier autenticado si `<id>` no es vacío
  - `global` -> permitido para cualquier autenticado
  """
  @spec authorize_topic(String.t(), String.t()) ::
          :ok | {:error, :forbidden_topic | :invalid_topic}
  def authorize_topic("global", _user_id), do: :ok

  def authorize_topic("message:" <> message_id, _user_id) do
    if String.trim(message_id) != "" do
      :ok
    else
      {:error, :invalid_topic}
    end
  end

  def authorize_topic("user:" <> target_user_id, user_id) do
    trimmed = String.trim(target_user_id)

    cond do
      trimmed == "" ->
        {:error, :invalid_topic}

      String.downcase(trimmed) == String.downcase(String.trim(user_id)) ->
        :ok

      true ->
        {:error, :forbidden_topic}
    end
  end

  def authorize_topic(_other, _user_id), do: {:error, :invalid_topic}

  @doc """
  Valida el header `Origin` contra la lista de orígenes permitidos.
  Si `allowed_origins` contiene `"*"` o está vacía, permite cualquiera.
  Si el cliente no envía `Origin` (ej. app móvil nativa), se permite.
  """
  @spec valid_origin?(String.t() | nil, [String.t()]) :: boolean()
  def valid_origin?(nil, _allowed), do: true
  def valid_origin?("", _allowed), do: true
  def valid_origin?("null", _allowed), do: true

  def valid_origin?(origin, allowed_origins) when is_list(allowed_origins) do
    normalized_origin = origin |> String.trim() |> String.trim_trailing("/")

    cond do
      allowed_origins == [] ->
        true

      "*" in allowed_origins ->
        true

      true ->
        Enum.any?(allowed_origins, fn allowed ->
          String.downcase(String.trim_trailing(String.trim(allowed), "/")) ==
            String.downcase(normalized_origin)
        end) or internal_origin?(normalized_origin)
    end
  end

  defp internal_origin?(origin) do
    case URI.parse(origin) do
      %URI{host: host} when is_binary(host) ->
        down = String.downcase(host)

        down in [
          "localhost",
          "127.0.0.1",
          "socket-gateway",
          "realtime",
          "gateway"
        ] or
          String.starts_with?(down, "192.168.") or
          String.starts_with?(down, "10.") or
          String.starts_with?(down, "172.")

      _ ->
        false
    end
  end

  @doc """
  Transforma un sobre de evento de RabbitMQ (o `/internal/publish`) en:
  `{:ok, topics, frame_map}` o `{:error, reason}`.
  """
  @spec route_event(map()) :: {:ok, [String.t()], map()} | {:error, atom()}
  def route_event(raw) when is_map(raw) do
    event_name = extract_string(raw, ["event", "eventType"])
    payload = Map.get(raw, "payload") || Map.get(raw, :payload) || %{}

    with true <- is_binary(event_name) and event_name != "",
         true <- is_map(payload),
         {:ok, topics} <- resolve_topics(event_name, payload) do
      event_id =
        extract_string(raw, ["eventId", "id"]) ||
          generate_uuid_v4()

      occurred_at =
        extract_string(raw, ["occurredAt", "timestamp"]) ||
          DateTime.utc_now() |> DateTime.to_iso8601()

      sanitized_payload = sanitize_payload(payload)

      frame = %{
        "type" => "event",
        "eventId" => event_id,
        "event" => event_name,
        "occurredAt" => occurred_at,
        "payload" => sanitized_payload
      }

      {:ok, Enum.uniq(topics), frame}
    else
      false ->
        Logger.warning("Dropping malformed realtime event without event name or payload")
        {:error, :invalid_envelope}

      {:error, reason} = err ->
        Logger.warning("Dropping event #{inspect(event_name)}: #{inspect(reason)}")
        err
    end
  end

  def route_event(_), do: {:error, :invalid_envelope}

  @doc """
  Determina los tópicos destino según la Sección 6 de `services/realtime/README_P2.md`.
  """
  @spec resolve_topics(String.t(), map()) :: {:ok, [String.t()]} | {:error, atom()}
  def resolve_topics(event_name, payload) when event_name in [
        "notification.requested.v1",
        "activity.created.v1",
        "reputation.changed.v1",
        "profile.updated.v1"
      ] do
    case extract_string(payload, ["userId", "user_id"]) do
      nil -> {:error, :missing_user_id}
      user_id when user_id in ["global", "*"] -> {:ok, ["global"]}
      user_id -> {:ok, ["user:#{user_id}"]}
    end
  end

  def resolve_topics("moderation.completed.v1", payload) do
    author_id = extract_string(payload, ["authorId", "author_id", "userId"])
    message_id = extract_string(payload, ["messageId", "message_id"])

    cond do
      is_binary(author_id) and author_id in ["global", "*"] and is_binary(message_id) ->
        {:ok, ["global", "message:#{message_id}"]}

      is_binary(author_id) and is_binary(message_id) ->
        {:ok, ["user:#{author_id}", "message:#{message_id}"]}

      true ->
        {:error, :missing_author_or_message_id}
    end
  end

  def resolve_topics("rating.changed.v1", payload) do
    message_id = extract_string(payload, ["messageId", "message_id"])
    author_id = extract_string(payload, ["messageAuthorId", "authorId", "author_id"])

    if is_binary(message_id) and is_binary(author_id) do
      {:ok, ["global", "message:#{message_id}", "user:#{author_id}"]}
    else
      {:error, :missing_message_or_author_id}
    end
  end

  def resolve_topics("message.published.v1", payload) do
    author_id = extract_string(payload, ["authorId", "author_id", "sender_id"])
    message_id = extract_string(payload, ["messageId", "message_id", "id"])

    if is_binary(author_id) and is_binary(message_id) do
      {:ok, ["global", "user:#{author_id}"]}
    else
      {:error, :missing_author_or_message_id}
    end
  end

  def resolve_topics("message.deleted.v1", payload) do
    message_id = extract_string(payload, ["messageId", "message_id", "id"])
    author_id = extract_string(payload, ["authorId", "author_id", "sender_id"])

    cond do
      is_binary(message_id) and is_binary(author_id) ->
        {:ok, ["global", "message:#{message_id}", "user:#{author_id}"]}

      is_binary(message_id) ->
        {:ok, ["global", "message:#{message_id}"]}

      true ->
        {:error, :missing_message_id}
    end
  end

  def resolve_topics(_unknown, _payload), do: {:error, :unsupported_event}

  @doc """
  Garantiza que no se reenvíe `content` completo y que `contentPreview` tenga <= 140 caracteres.
  """
  @spec sanitize_payload(map()) :: map()
  def sanitize_payload(payload) when is_map(payload) do
    stringified =
      Map.new(payload, fn {k, v} ->
        {to_string(k), v}
      end)

    cond do
      Map.has_key?(stringified, "contentPreview") and is_binary(stringified["contentPreview"]) ->
        stringified
        |> Map.delete("content")
        |> Map.put("contentPreview", truncate_preview(stringified["contentPreview"]))

      Map.has_key?(stringified, "content") and is_binary(stringified["content"]) ->
        preview = truncate_preview(stringified["content"])

        stringified
        |> Map.delete("content")
        |> Map.put("contentPreview", preview)

      true ->
        stringified
    end
  end

  defp truncate_preview(text) when is_binary(text) do
    String.slice(text, 0, @max_preview_length)
  end

  defp extract_string(map, keys) do
    Enum.find_value(keys, fn key ->
      val = Map.get(map, key) || Map.get(map, String.to_atom(key))

      case val do
        v when is_binary(v) ->
          trimmed = String.trim(v)
          if trimmed != "", do: trimmed, else: nil

        _ ->
          nil
      end
    end)
  end

  def generate_uuid_v4 do
    <<u0::48, _::4, u1::12, _::2, u2::62>> = :crypto.strong_rand_bytes(16)

    <<u0::48, 4::4, u1::12, 2::2, u2::62>>
    |> Base.encode16(case: :lower)
    |> case do
      <<a::binary-size(8), b::binary-size(4), c::binary-size(4), d::binary-size(4),
        e::binary-size(12)>> ->
        "#{a}-#{b}-#{c}-#{d}-#{e}"
    end
  end
end
