export type MessageStatus = 'pendiente' | 'publicado' | 'oculto' | 'eliminado';

export type BackendMessageStatus = 'PENDING' | 'PUBLISHED' | 'BLOCKED' | 'DELETED';

export type ModerationStatus =
  | 'PENDING'
  | 'ALLOW'
  | 'WARN'
  | 'BLOCK'
  | 'REVIEW'
  | 'DEGRADED';

export interface GeoMessage {
  id: string;
  authorId: string;
  authorName: string;
  authorColor: string; // Color distintivo del autor
  content: string;     // Máximo 140 caracteres
  latitude: number;
  longitude: number;
  createdAt: string;   // ISO timestamp
  expiresAt: string;   // ISO timestamp (asignado automáticamente)
  status: MessageStatus;
  /** Estado de moderación del backend; WARN se muestra con badge. */
  moderationStatus?: ModerationStatus;
  moderationReason?: string;
  likes?: number;
  dislikes?: number;
  score?: number;
  myRating?: 'LIKE' | 'DISLIKE' | null;
}

export interface User {
  id: string;
  username: string;
  email: string;
  color: string;
  token?: string;      // Token JWT emitido por el microservicio de autenticación
}

/** Perfil público de otro explorador (servicio de perfiles). */
export interface UserProfile {
  userId: string;
  username: string;
  displayName: string | null;
  about: string | null;
  avatarUrl: string | null;
  color: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface LocationCoords {
  latitude: number;
  longitude: number;
}

export type RangeDistance = 100 | 300 | 500;

// ==========================================
// Contratos y DTOs para el API Gateway
// ==========================================

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  statusCode?: number;
}

export interface LoginCredentials {
  usernameOrEmail: string;
  password?: string;
}

export interface RegisterCredentials {
  username: string;
  email: string;
  password?: string;
}

export interface AuthResponseData {
  user: User;
  token: string;
  refreshToken?: string;
  expiresIn?: number;
}

/** Mensaje tal como lo devuelve el servicio de mensajes (Go) a través del gateway */
export interface ApiMessage {
  id: string;
  sender_id: string;
  content: string;
  location: { latitude: number; longitude: number };
  created_at: string;
  status?: BackendMessageStatus;
  moderation_status?: ModerationStatus | null;
  moderation_reason?: string | null;
  version?: number;
  updated_at?: string;
}

export interface CreateMessageDto {
  content: string;
  latitude: number;
  longitude: number;
  status?: MessageStatus;
  expirationHours?: number;
}

export interface QueryMessagesParams {
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  status?: MessageStatus | 'todos';
  /** Para mostrar el nombre y color reales en los mensajes propios */
  currentUser?: { id: string; username: string; color: string } | null;
}

// ==========================================
// Contratos y DTOs para el Servicio de Red Social (Network)
// ==========================================

export type FriendshipStatus = 'pending' | 'accepted';

/** Relación de amistad tal como la usa la interfaz (convertida desde GraphQL en networkService) */
export interface Friendship {
  id: string;
  user_a: string;
  user_b: string;
  status: FriendshipStatus;
  requested_by: string;
  created_at: string;
  updated_at: string;
  /** Campo derivado: ID del otro usuario con respecto al usuario actual */
  other_user_id?: string;
  /** Campo derivado: true si la solicitud fue emitida por el usuario actual */
  sent_by_me?: boolean;
  /** Perfil público del otro usuario, cuando está disponible. */
  profile?: UserProfile | null;
}

/** Representación devuelta por la API GraphQL de Network */
export interface GraphQLFriendship {
  id: string;
  userA: string;
  userB: string;
  status: 'PENDING' | 'ACCEPTED';
  requestedBy: string;
  createdAt: string;
  updatedAt: string;
  otherUserId: string;
  sentByMe: boolean;
}

// ==========================================
// Contratos y DTOs para Realtime (Socket Gateway)
// ==========================================

export interface SocketTicketResponse {
  ticket: string;
  expiresIn: number;
}

export type RealtimeConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error';

export type RealtimeEventName =
  | 'notification.requested.v1'
  | 'activity.created.v1'
  | 'reputation.changed.v1'
  | 'moderation.completed.v1'
  | 'rating.changed.v1'
  | 'message.published.v1'
  | 'message.deleted.v1'
  | 'profile.updated.v1';

export interface RealtimeEventFrame<T = any> {
  type: 'event';
  eventId: string;
  event: RealtimeEventName;
  occurredAt: string;
  payload: T;
}

export interface RealtimeReadyFrame {
  type: 'ready';
  connectionId: string;
  userId: string;
}

export interface RealtimePongFrame {
  type: 'pong';
  ts: number;
}

export interface RealtimeErrorFrame {
  type: 'error';
  code: string;
  message: string;
}

export type RealtimeServerFrame =
  | RealtimeReadyFrame
  | RealtimeEventFrame
  | RealtimePongFrame
  | RealtimeErrorFrame;

export interface RealtimeToast {
  id: string;
  title: string;
  message: string;
  variant: 'info' | 'success' | 'warning' | 'error';
  createdAt: number;
}


