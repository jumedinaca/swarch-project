defmodule Realtime.RouterAndSocketTest do
  use ExUnit.Case, async: false
  import Plug.Test
  import Plug.Conn

  alias Realtime.{Router, WsSocket}

  @opts Router.init([])

  setup do
    Application.put_env(:realtime, :use_memory_redis, true)
    Application.put_env(:realtime, :force_redis_down, false)
    Application.put_env(:realtime, :force_rabbitmq_down, false)
    Application.put_env(:realtime, :mock_rabbitmq_healthy, true)
    Application.put_env(:realtime, :internal_token, "test-internal-token")
    :ok
  end

  describe "POST /tickets y consumo de un solo uso" do
    test "rechaza con 401 si falta X-User-ID" do
      conn =
        conn(:post, "/tickets")
        |> Router.call(@opts)

      assert conn.status == 401
      body = Jason.decode!(conn.resp_body)
      assert body["error"] == "unauthorized"
    end

    test "emite un ticket efímero válido de un solo uso" do
      user_id = "7b8339ec-2e38-47b3-9d3b-7643652f1fc7"

      conn =
        conn(:post, "/tickets")
        |> put_req_header("x-user-id", user_id)
        |> Router.call(@opts)

      assert conn.status == 200
      body = Jason.decode!(conn.resp_body)
      assert is_binary(body["ticket"])
      assert body["expiresIn"] == 60

      # Primer consumo tiene éxito
      assert {:ok, ^user_id} = Realtime.Redis.consume_ticket(body["ticket"])

      # Segundo consumo con el mismo ticket falla (one-time use)
      assert {:error, :invalid_or_expired} = Realtime.Redis.consume_ticket(body["ticket"])
    end

    test "responde 503 fail-closed cuando Redis no está disponible" do
      Application.put_env(:realtime, :force_redis_down, true)

      conn =
        conn(:post, "/tickets")
        |> put_req_header("x-user-id", "7b8339ec-2e38-47b3-9d3b-7643652f1fc7")
        |> Router.call(@opts)

      assert conn.status == 503

      health_conn =
        conn(:get, "/health")
        |> Router.call(@opts)

      assert health_conn.status == 503
      assert Jason.decode!(health_conn.resp_body)["redis"] == "down"
    end
  end

  describe "GET /health" do
    test "reporta ok (200) cuando Redis y RabbitMQ están activos y degraded (200) si RabbitMQ cae" do
      ok_conn = conn(:get, "/health") |> Router.call(@opts)
      assert ok_conn.status == 200
      assert Jason.decode!(ok_conn.resp_body)["status"] == "ok"

      Application.put_env(:realtime, :force_rabbitmq_down, true)
      deg_conn = conn(:get, "/health") |> Router.call(@opts)
      assert deg_conn.status == 200
      assert Jason.decode!(deg_conn.resp_body)["status"] == "degraded"
    end
  end

  describe "Protocolo WebSocket (WsSocket)" do
    test "envía ready al iniciar, responde pong a ping, autoriza tópicos y recibe eventos publicados" do
      user_id = "7b8339ec-2e38-47b3-9d3b-7643652f1fc7"
      conn_id = "c-test01"

      assert {:push, {:text, ready_json}, state} =
               WsSocket.init(%{user_id: user_id, connection_id: conn_id})

      ready = Jason.decode!(ready_json)
      assert ready["type"] == "ready"
      assert ready["userId"] == user_id
      assert ready["connectionId"] == conn_id

      # Ping -> Pong
      ping_msg = Jason.encode!(%{"type" => "ping", "ts" => 1_791_763_200_000})

      assert {:push, {:text, pong_json}, state} =
               WsSocket.handle_in({ping_msg, [opcode: :text]}, state)

      assert Jason.decode!(pong_json) == %{"type" => "pong", "ts" => 1_791_763_200_000}

      # Suscribirse al tópico propio y global
      sub_msg =
        Jason.encode!(%{
          "type" => "subscribe",
          "requestId" => "1",
          "topics" => ["user:#{user_id}", "global"]
        })

      assert {:ok, state} = WsSocket.handle_in({sub_msg, [opcode: :text]}, state)

      # Intentar suscribirse al tópico privado de otro usuario -> forbidden_topic
      bad_sub =
        Jason.encode!(%{
          "type" => "subscribe",
          "requestId" => "2",
          "topics" => ["user:00000000-0000-0000-0000-000000000000"]
        })

      assert {:push, {:text, err_json}, state} =
               WsSocket.handle_in({bad_sub, [opcode: :text]}, state)

      assert Jason.decode!(err_json)["code"] == "forbidden_topic"

      # Publicar evento por POST /internal/publish dirigido a user:<user_id>
      event_body =
        Jason.encode!(%{
          "eventId" => "evt-900",
          "eventType" => "reputation.changed.v1",
          "occurredAt" => "2026-10-24T14:31:05Z",
          "payload" => %{
            "userId" => user_id,
            "score" => 50,
            "level" => "Miembro",
            "levelChanged" => true
          }
        })

      pub_conn =
        conn(:post, "/internal/publish", event_body)
        |> put_req_header("content-type", "application/json")
        |> put_req_header("x-internal-token", "test-internal-token")
        |> Router.call(@opts)

      assert pub_conn.status == 202

      assert_receive {:push_event, pushed_json}, 500
      assert {:push, {:text, ^pushed_json}, state} =
               WsSocket.handle_info({:push_event, pushed_json}, state)

      pushed = Jason.decode!(pushed_json)
      assert pushed["type"] == "event"
      assert pushed["event"] == "reputation.changed.v1"
      assert pushed["payload"]["level"] == "Miembro"

      WsSocket.terminate(:normal, state)
    end
  end
end
