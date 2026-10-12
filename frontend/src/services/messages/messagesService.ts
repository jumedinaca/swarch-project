import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import {
  ApiMessage,
  GeoMessage,
  CreateMessageDto,
  QueryMessagesParams,
} from '../../types';
import { BOGOTA_SEED_MESSAGES } from '../../data/bogotaMessages';
import { nintendoTheme } from '../../theme/nintendoTheme';

type Author = { id: string; username: string; color: string };

// El servicio de mensajes no guarda expiración; se asume la vigencia por defecto de la app
const DEFAULT_EXPIRATION_HOURS = 24;

function colorFor(userId: string): string {
  const palette = nintendoTheme.colors.avatarColors;
  let hash = 0;
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

/**
 * Convierte el mensaje del servicio de mensajes ({ sender_id, location, created_at })
 * al modelo que usa la interfaz. El servicio solo guarda el id del autor, así que el
 * nombre y color reales solo se conocen para los mensajes del usuario actual.
 */
export function toGeoMessage(message: ApiMessage, currentUser?: Author | null): GeoMessage {
  const isMine = !!currentUser && message.sender_id === currentUser.id;
  const createdAt = new Date(message.created_at);
  return {
    id: message.id,
    authorId: message.sender_id,
    authorName: isMine ? currentUser!.username : `Explorador ${message.sender_id.slice(0, 4)}`,
    authorColor: isMine ? currentUser!.color : colorFor(message.sender_id),
    content: message.content,
    latitude: message.location.latitude,
    longitude: message.location.longitude,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + DEFAULT_EXPIRATION_HOURS * 3600 * 1000).toISOString(),
    status: 'publicado',
  };
}

class MessagesService {
  private mockMessages: GeoMessage[] = [...BOGOTA_SEED_MESSAGES];

  /**
   * Obtiene los mensajes cercanos a un punto desde el API Gateway
   * (GET /api/messages/nearby?lat=&lng=&radius=, ruta pública).
   */
  public async getMessages(
    params?: QueryMessagesParams
  ): Promise<{ success: boolean; data: GeoMessage[]; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.filterMockMessages(params) };
    }

    // El servicio real solo almacena mensajes publicados
    if (params?.status && params.status !== 'todos' && params.status !== 'publicado') {
      return { success: true, data: [] };
    }
    if (params?.latitude === undefined || params?.longitude === undefined) {
      return { success: true, data: [] };
    }

    try {
      const query = new URLSearchParams({
        lat: String(params.latitude),
        lng: String(params.longitude),
        radius: String(params.radiusMeters ?? 500),
      });
      const endpoint = `${API_CONFIG.ROUTES.MESSAGES.NEARBY}?${query.toString()}`;

      const response = await apiClient.get<ApiMessage[]>(endpoint);

      if (response.success && Array.isArray(response.data)) {
        return {
          success: true,
          data: response.data.map((m) => toGeoMessage(m, params.currentUser)),
        };
      }

      return {
        success: false,
        data: [],
        error: response.message || 'No se pudieron recuperar los mensajes.',
      };
    } catch (error: any) {
      console.warn(
        `[MessagesService] Error al conectar con el Gateway (${API_CONFIG.ROUTES.MESSAGES.NEARBY}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[MessagesService] Activando fallback con mensajes locales.');
        return { success: true, data: this.filterMockMessages(params) };
      }

      return {
        success: false,
        data: [],
        error: error.message || 'Error de conexión con el servicio de mensajes.',
      };
    }
  }

  /**
   * Publica una nueva nota geoespacial a través del API Gateway (/api/messages)
   */
  public async createMessage(
    dto: CreateMessageDto,
    author: { id: string; username: string; color: string }
  ): Promise<{ success: boolean; data?: GeoMessage; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockCreateMessage(dto, author);
    }

    try {
      // El servicio de mensajes toma el autor de X-User-ID (lo agrega el gateway desde el JWT)
      const response = await apiClient.post<ApiMessage>(API_CONFIG.ROUTES.MESSAGES.CREATE, {
        content: dto.content,
        latitude: dto.latitude,
        longitude: dto.longitude,
      });

      if (response.success && response.data) {
        return { success: true, data: toGeoMessage(response.data, author) };
      }

      return {
        success: false,
        error: response.message || 'No se pudo publicar el mensaje.',
      };
    } catch (error: any) {
      console.warn(
        `[MessagesService] Error al crear mensaje en Gateway (${API_CONFIG.ROUTES.MESSAGES.CREATE}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[MessagesService] Activando fallback para crear mensaje localmente.');
        return this.mockCreateMessage(dto, author);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al enviar el mensaje.',
      };
    }
  }

  /**
   * Elimina un mensaje por su ID a través del API Gateway (/api/messages/:id)
   */
  public async deleteMessage(
    messageId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockDeleteMessage(messageId);
    }

    try {
      const response = await apiClient.delete(
        API_CONFIG.ROUTES.MESSAGES.DELETE(messageId)
      );

      if (response.success) {
        return { success: true };
      }

      return {
        success: false,
        error: response.message || 'No se pudo eliminar el mensaje.',
      };
    } catch (error: any) {
      console.warn(
        `[MessagesService] Error al eliminar mensaje en Gateway (${messageId}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[MessagesService] Activando fallback para marcar eliminado localmente.');
        return this.mockDeleteMessage(messageId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al eliminar el mensaje.',
      };
    }
  }

  // ==========================================
  // Métodos de simulación (Mock / Fallback)
  // ==========================================

  private filterMockMessages(params?: QueryMessagesParams): GeoMessage[] {
    let result = [...this.mockMessages];
    if (params?.status && params.status !== 'todos') {
      result = result.filter((m) => m.status === params.status);
    }
    return result;
  }

  private mockCreateMessage(
    dto: CreateMessageDto,
    author: { id: string; username: string; color: string }
  ): { success: boolean; data: GeoMessage } {
    const now = new Date();
    const expHours = dto.expirationHours || 24;
    const expiresAt = new Date(now.getTime() + expHours * 3600 * 1000).toISOString();

    const newMessage: GeoMessage = {
      id: `msg-${Date.now()}`,
      authorId: author.id,
      authorName: author.username,
      authorColor: author.color,
      content: dto.content,
      latitude: dto.latitude,
      longitude: dto.longitude,
      createdAt: now.toISOString(),
      expiresAt,
      status: dto.status || 'publicado',
    };

    this.mockMessages = [newMessage, ...this.mockMessages];
    return { success: true, data: newMessage };
  }

  private mockDeleteMessage(messageId: string): { success: boolean } {
    this.mockMessages = this.mockMessages.map((m) =>
      m.id === messageId ? { ...m, status: 'eliminado' as const } : m
    );
    return { success: true };
  }
}

export const messagesService = new MessagesService();
