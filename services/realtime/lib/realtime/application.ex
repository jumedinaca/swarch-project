defmodule Realtime.Application do
  @moduledoc """
  Árbol de supervisión OTP del servicio Realtime (`socket-gateway`).
  """

  use Application
  require Logger

  alias Realtime.{Config, Dispatcher, Metrics}

  @impl true
  def start(_type, _args) do
    Metrics.setup()

    start_infra? = Application.get_env(:realtime, :start_infra, true)

    base_children = [
      {Registry, keys: :duplicate, name: Dispatcher.topic_registry_name()},
      {Registry, keys: :duplicate, name: Dispatcher.user_registry_name()}
    ]

    infra_children =
      if start_infra? do
        redis_url = Config.redis_url()
        port = Config.port()

        Logger.info("Starting GeoPicto Realtime Socket Gateway on port #{port}")

        [
          %{
            id: :redix_cmd,
            start: {Redix, :start_link, [redis_url, [name: Realtime.Redix, sync_connect: false]]}
          },
          %{
            id: :redix_pubsub,
            start:
              {Redix.PubSub, :start_link,
               [redis_url, [name: Realtime.Redix.PubSub, sync_connect: false]]}
          },
          {Realtime.Redis, []},
          {Realtime.RabbitConsumer, [enabled: true]},
          {Bandit, plug: Realtime.Router, scheme: :http, port: port}
        ]
      else
        [
          {Realtime.Redis, []},
          {Realtime.RabbitConsumer, [enabled: false]}
        ]
      end

    opts = [strategy: :one_for_one, name: Realtime.Supervisor]
    Supervisor.start_link(base_children ++ infra_children, opts)
  end
end
