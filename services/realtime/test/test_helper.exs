Application.put_env(:realtime, :use_memory_redis, true)
Application.put_env(:realtime, :mock_rabbitmq_healthy, true)
Application.put_env(:realtime, :start_infra, false)

{:ok, _} = Application.ensure_all_started(:realtime)

ExUnit.start()
