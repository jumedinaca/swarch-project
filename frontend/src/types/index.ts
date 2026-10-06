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
  expiresIn?: number;
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
}
