import { colorForId } from "./format";
import { gatewayJson, GatewayError } from "./gateway";
import type { Session } from "./session";
import { DEFAULT_LOCATION } from "./theme";
import type {
  AccountData,
  AccountMessage,
  AccountMessageStatus,
  ApiMessage,
  Friendship,
  GraphQLFriendship,
  NetworkData,
  NetworkMember,
  Profile,
  Reputation,
  ReputationEntry,
} from "./types";

const FRIENDSHIP_FIELDS = `
  id
  userA
  userB
  status
  requestedBy
  createdAt
  updatedAt
  otherUserId
  sentByMe
`;

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function mapStatus(status?: string | null, moderationStatus?: string | null): AccountMessageStatus {
  const normalized = (status || "PUBLISHED").toUpperCase();
  if (normalized === "PENDING") return "pendiente";
  if (normalized === "DELETED") return "eliminado";
  if (normalized === "BLOCKED" || String(moderationStatus || "").toUpperCase() === "BLOCK") {
    return "oculto";
  }
  return "publicado";
}

function toFriendship(item: GraphQLFriendship): Friendship {
  return {
    id: item.id,
    user_a: item.userA,
    user_b: item.userB,
    status: item.status === "ACCEPTED" ? "accepted" : "pending",
    requested_by: item.requestedBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
    other_user_id: item.otherUserId,
    sent_by_me: item.sentByMe,
  };
}

function toMember(friendship: Friendship, profiles: Map<string, Profile>): NetworkMember {
  const userId =
    friendship.other_user_id ||
    (friendship.user_a === friendship.requested_by ? friendship.user_b : friendship.user_a);
  return {
    friendship,
    userId,
    profile: profiles.get(userId) ?? null,
  };
}

function toMessage(
  message: ApiMessage,
  session: Session,
  profiles: Map<string, Profile>,
): AccountMessage {
  const authorProfile = profiles.get(message.sender_id);
  const isMine = message.sender_id === session.userId;
  const fallbackName = isMine
    ? session.username || "Tú"
    : `Explorador ${message.sender_id.slice(0, 4)}`;

  return {
    id: message.id,
    authorId: message.sender_id,
    authorName:
      authorProfile?.displayName || authorProfile?.username || fallbackName,
    authorColor: authorProfile?.color || colorForId(message.sender_id),
    content: message.content,
    latitude: message.location.latitude,
    longitude: message.location.longitude,
    createdAt: message.created_at,
    status: mapStatus(message.status, message.moderation_status),
    moderationStatus: message.moderation_status ?? null,
    isMine,
  };
}

async function fetchBatchProfiles(
  ids: string[],
  token: string,
): Promise<Map<string, Profile>> {
  const unique = Array.from(new Set(ids.filter(Boolean)));
  const map = new Map<string, Profile>();
  if (unique.length === 0) return map;

  for (let index = 0; index < unique.length; index += 100) {
    const chunk = unique.slice(index, index + 100);
    const query = new URLSearchParams({ ids: chunk.join(",") });
    try {
      const profiles = await gatewayJson<Profile[]>(`/api/profiles/batch?${query}`, {
        token,
      });
      for (const item of profiles) map.set(item.userId, item);
    } catch {
      // El lote es un enriquecimiento: si falla, la cuenta sigue siendo usable.
    }
  }
  return map;
}

async function fetchNetwork(token: string): Promise<NetworkData> {
  const body = await gatewayJson<GraphQLResponse<{
    friends: GraphQLFriendship[];
    incomingRequests: GraphQLFriendship[];
    outgoingRequests: GraphQLFriendship[];
  }>>("/api/network/graphql", {
    method: "POST",
    token,
    body: {
      query: `
        query NetworkOverview {
          friends { ${FRIENDSHIP_FIELDS} }
          incomingRequests { ${FRIENDSHIP_FIELDS} }
          outgoingRequests { ${FRIENDSHIP_FIELDS} }
        }
      `,
    },
  });

  if (body.errors?.length) {
    throw new GatewayError(body.errors[0].message, 502, body.errors[0].extensions?.code);
  }
  if (!body.data) {
    throw new GatewayError("No se pudo cargar tu red de amigos. Inténtalo de nuevo.", 502);
  }

  const emptyProfiles = new Map<string, Profile>();
  return {
    friends: body.data.friends.map((item) =>
      toMember(toFriendship(item), emptyProfiles),
    ),
    incoming: body.data.incomingRequests.map((item) =>
      toMember(toFriendship(item), emptyProfiles),
    ),
    outgoing: body.data.outgoingRequests.map((item) =>
      toMember(toFriendship(item), emptyProfiles),
    ),
  };
}

function nearbyUrl(): string {
  const query = new URLSearchParams({
    lat: String(DEFAULT_LOCATION.latitude),
    lng: String(DEFAULT_LOCATION.longitude),
    radius: String(DEFAULT_LOCATION.radius),
  });
  return `/api/messages/nearby?${query}`;
}

export async function loadLiveAccountData(session: Session): Promise<AccountData> {
  const token = session.accessToken;

  const [profile, reputation, history, apiMessages, network] = await Promise.all([
    gatewayJson<Profile>("/api/profiles/me", { token }),
    gatewayJson<Reputation>("/api/reputation/me", { token }),
    gatewayJson<ReputationEntry[]>(
      `/api/reputation/${session.userId}/history?limit=12`,
      { token },
    ).catch(() => []),
    gatewayJson<ApiMessage[]>(nearbyUrl(), { token }),
    fetchNetwork(token),
  ]);

  // Segundo paso: se piden en lote los perfiles de autores y amigos.
  const ids = [
    session.userId,
    ...apiMessages.map((message) => message.sender_id),
    ...network.friends.map((member) => member.userId),
    ...network.incoming.map((member) => member.userId),
    ...network.outgoing.map((member) => member.userId),
  ];
  const profiles = await fetchBatchProfiles(ids, token);
  profiles.set(profile.userId, profile);

  const friendIds = [
    ...network.friends.map((member) => member.userId),
    ...network.incoming.map((member) => member.userId),
    ...network.outgoing.map((member) => member.userId),
  ];
  const friendProfiles = await fetchBatchProfiles(friendIds, token);
  const enrichedNetwork: NetworkData = {
    friends: network.friends.map((member) => ({
      ...member,
      profile: friendProfiles.get(member.userId) ?? member.profile,
    })),
    incoming: network.incoming.map((member) => ({
      ...member,
      profile: friendProfiles.get(member.userId) ?? member.profile,
    })),
    outgoing: network.outgoing.map((member) => ({
      ...member,
      profile: friendProfiles.get(member.userId) ?? member.profile,
    })),
  };

  return {
    profile,
    reputation,
    history,
    messages: apiMessages.map((message) => toMessage(message, session, profiles)),
    network: enrichedNetwork,
    loadedAt: new Date().toISOString(),
  };
}
