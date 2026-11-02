defmodule Realtime.EventRouterTest do
  use ExUnit.Case, async: true

  alias Realtime.EventRouter

  describe "authorize_topic/2" do
    test "permite suscribirse al tópico global y a cualquier message:<id>" do
      user_id = "7b8339ec-2e38-47b3-9d3b-7643652f1fc7"
      assert :ok == EventRouter.authorize_topic("global", user_id)
      assert :ok == EventRouter.authorize_topic("message:550e8400-e29b-41d4-a716-446655440000", user_id)
    end

    test "permite suscribirse a su propio user:<id> e impide suscribirse al de otro usuario" do
      user_id = "7b8339ec-2e38-47b3-9d3b-7643652f1fc7"
      other_id = "99999999-2e38-47b3-9d3b-7643652f1fc7"

      assert :ok == EventRouter.authorize_topic("user:#{user_id}", user_id)
      assert {:error, :forbidden_topic} == EventRouter.authorize_topic("user:#{other_id}", user_id)
    end

    test "rechaza tópicos mal formados" do
      user_id = "7b8339ec-2e38-47b3-9d3b-7643652f1fc7"
      assert {:error, :invalid_topic} == EventRouter.authorize_topic("user:", user_id)
      assert {:error, :invalid_topic} == EventRouter.authorize_topic("message:", user_id)
      assert {:error, :invalid_topic} == EventRouter.authorize_topic("admin:all", user_id)
    end
  end

  describe "route_event/1" do
    test "mapea rating.changed.v1 a message:<messageId> y user:<messageAuthorId>" do
      raw = %{
        "eventId" => "0192f3a4-1111-4000-8000-000000000001",
        "eventType" => "rating.changed.v1",
        "occurredAt" => "2026-10-24T14:30:00Z",
        "payload" => %{
          "messageId" => "550e8400-e29b-41d4-a716-446655440000",
          "messageAuthorId" => "7b8339ec-2e38-47b3-9d3b-7643652f1fc7",
          "likes" => 5,
          "dislikes" => 1
        }
      }

      assert {:ok, topics, frame} = EventRouter.route_event(raw)
      assert "message:550e8400-e29b-41d4-a716-446655440000" in topics
      assert "user:7b8339ec-2e38-47b3-9d3b-7643652f1fc7" in topics
      assert frame["type"] == "event"
      assert frame["event"] == "rating.changed.v1"
      assert frame["eventId"] == "0192f3a4-1111-4000-8000-000000000001"
      assert frame["payload"]["likes"] == 5
    end

    test "mapea moderation.completed.v1 a user:<authorId> y message:<messageId>" do
      raw = %{
        "eventId" => "0192f3a4-2222-4000-8000-000000000002",
        "eventType" => "moderation.completed.v1",
        "payload" => %{
          "messageId" => "msg-123",
          "authorId" => "usr-456",
          "decision" => "BLOCK"
        }
      }

      assert {:ok, topics, frame} = EventRouter.route_event(raw)
      assert topics == ["user:usr-456", "message:msg-123"]
      assert frame["event"] == "moderation.completed.v1"
    end

    test "mapea message.published.v1 a global y user:<authorId> y trunca content a <= 140 chars" do
      long_text = String.duplicate("a", 200)

      raw = %{
        "eventType" => "message.published.v1",
        "payload" => %{
          "messageId" => "msg-999",
          "authorId" => "usr-999",
          "content" => long_text
        }
      }

      assert {:ok, topics, frame} = EventRouter.route_event(raw)
      assert topics == ["global", "user:usr-999"]
      refute Map.has_key?(frame["payload"], "content")
      assert String.length(frame["payload"]["contentPreview"]) == 140
    end

    test "descarta eventos si falta userId o messageId" do
      assert {:error, :missing_user_id} =
               EventRouter.route_event(%{"eventType" => "reputation.changed.v1", "payload" => %{}})

      assert {:error, :missing_author_or_message_id} =
               EventRouter.route_event(%{
                 "eventType" => "moderation.completed.v1",
                 "payload" => %{"authorId" => "only-author"}
               })
    end
  end

  describe "valid_origin?/2" do
    test "valida contra orígenes configurados" do
      allowed = ["http://localhost:8081", "https://geopicto.org"]
      assert EventRouter.valid_origin?("http://localhost:8081", allowed)
      assert EventRouter.valid_origin?("http://localhost:8081/", allowed)
      assert EventRouter.valid_origin?(nil, allowed)
      refute EventRouter.valid_origin?("http://evil.example.com", allowed)
    end
  end
end
