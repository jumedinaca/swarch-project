export interface Profile {
  userId: string;
  username: string;
  displayName: string | null;
  about: string | null;
  avatarUrl: string | null;
  color: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface Reputation {
  userId: string;
  score: number;
  level: string;
  levelIndex: number;
  nextLevelAt: number;
  progress: number;
  likesReceived: number;
  dislikesReceived: number;
  messagesBlocked: number;
  messagesWarned: number;
  updatedAt: string;
}

export interface ReputationEntry {
  id: string;
  userId?: string;
  delta: number;
  appliedDelta: number;
  reason: string;
  scoreAfter: number;
  createdAt: string;
}

export interface ApiMessage {
  id: string;
  sender_id: string;
  content: string;
  location: { latitude: number; longitude: number };
  created_at: string;
  status?: "PENDING" | "PUBLISHED" | "BLOCKED" | "DELETED" | string;
  moderation_status?: string | null;
  moderation_reason?: string | null;
  version?: number;
  updated_at?: string;
}

export type AccountMessageStatus =
  | "pendiente"
  | "publicado"
  | "oculto"
  | "eliminado";

export interface AccountMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string;
  content: string;
  latitude: number;
  longitude: number;
  createdAt: string;
  status: AccountMessageStatus;
  moderationStatus?: string | null;
  isMine: boolean;
}

export interface Friendship {
  id: string;
  user_a: string;
  user_b: string;
  status: "pending" | "accepted";
  requested_by: string;
  created_at: string;
  updated_at: string;
  other_user_id?: string;
  sent_by_me?: boolean;
}

export interface GraphQLFriendship {
  id: string;
  userA: string;
  userB: string;
  status: "PENDING" | "ACCEPTED";
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  otherUserId: string;
  sentByMe: boolean;
}

export interface NetworkMember {
  friendship: Friendship;
  userId: string;
  profile: Profile | null;
}

export interface NetworkData {
  friends: NetworkMember[];
  incoming: NetworkMember[];
  outgoing: NetworkMember[];
}

export interface AccountData {
  profile: Profile;
  reputation: Reputation;
  history: ReputationEntry[];
  messages: AccountMessage[];
  network: NetworkData;
  loadedAt: string;
}

export type AccountMode = "live" | "demo";

export interface ActionResult {
  ok: boolean;
  error?: string;
  message?: string;
}

export interface ProfileSearchResult {
  ok: boolean;
  profiles?: Profile[];
  error?: string;
}
