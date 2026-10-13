export type MessageStatus = 'pendiente' | 'publicado' | 'oculto' | 'eliminado';

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
}

export interface User {
  id: string;
  username: string;
  email: string;
  color: string;
  token?: string;      // Token JWT emitido por el microservicio de autenticación
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


