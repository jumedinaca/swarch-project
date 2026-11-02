defmodule Realtime.Metrics do
  @moduledoc """
  Contadores atómicos en memoria para observabilidad (/health y /metrics Prometheus).
  """

  @table :realtime_metrics

  @keys [
    :active_connections,
    :tickets_issued_total,
    :tickets_consumed_total,
    :tickets_rejected_total,
    :events_received_total,
    :events_pushed_total,
    :events_dropped_total,
    :rate_limited_total
  ]

  def setup do
    case :ets.whereis(@table) do
      :undefined ->
        :ets.new(@table, [:named_table, :public, :set, {:write_concurrency, true}])

      _ ->
        :ok
    end

    Enum.each(@keys, fn key ->
      :ets.insert_new(@table, {key, 0})
    end)

    :ok
  end

  def inc(key, delta \\ 1) when key in @keys do
    ensure_setup()
    :ets.update_counter(@table, key, {2, delta}, {key, 0})
  end

  def dec(key, delta \\ 1) when key in @keys do
    ensure_setup()
    val = :ets.update_counter(@table, key, {2, -delta}, {key, 0})

    if val < 0 do
      :ets.insert(@table, {key, 0})
      0
    else
      val
    end
  end

  def get(key) when key in @keys do
    ensure_setup()

    case :ets.lookup(@table, key) do
      [{^key, val}] -> max(val, 0)
      [] -> 0
    end
  end

  def snapshot do
    ensure_setup()
    Map.new(@keys, fn k -> {k, get(k)} end)
  end

  def prometheus_text do
    m = snapshot()

    """
    # HELP realtime_active_connections Current number of active WebSocket connections
    # TYPE realtime_active_connections gauge
    realtime_active_connections #{m.active_connections}
    # HELP realtime_tickets_issued_total Total ephemeral WebSocket tickets issued
    # TYPE realtime_tickets_issued_total counter
    realtime_tickets_issued_total #{m.tickets_issued_total}
    # HELP realtime_tickets_consumed_total Total ephemeral WebSocket tickets consumed
    # TYPE realtime_tickets_consumed_total counter
    realtime_tickets_consumed_total #{m.tickets_consumed_total}
    # HELP realtime_tickets_rejected_total Total invalid or expired tickets rejected
    # TYPE realtime_tickets_rejected_total counter
    realtime_tickets_rejected_total #{m.tickets_rejected_total}
    # HELP realtime_events_received_total Total broker events processed
    # TYPE realtime_events_received_total counter
    realtime_events_received_total #{m.events_received_total}
    # HELP realtime_events_pushed_total Total event frames pushed to WebSocket clients
    # TYPE realtime_events_pushed_total counter
    realtime_events_pushed_total #{m.events_pushed_total}
    # HELP realtime_events_dropped_total Total invalid or backpressured events dropped
    # TYPE realtime_events_dropped_total counter
    realtime_events_dropped_total #{m.events_dropped_total}
    # HELP realtime_rate_limited_total Total connections closed due to rate limit
    # TYPE realtime_rate_limited_total counter
    realtime_rate_limited_total #{m.rate_limited_total}
    """
  end

  defp ensure_setup do
    if :ets.whereis(@table) == :undefined do
      setup()
    end
  end
end
