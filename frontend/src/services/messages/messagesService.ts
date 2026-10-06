import { API_CONFIG } from '../../config/api.config';
import { apiClient } from '../api/apiClient';
import {
  GeoMessage,
  CreateMessageDto,
  QueryMessagesParams,
  ApiResponse,
} from '../../types';
import { BOGOTA_SEED_MESSAGES } from '../../data/bogotaMessages';

class MessagesService {
  private mockMessages: GeoMessage[] = [...BOGOTA_SEED_MESSAGES];

  /**
   * Obtiene la lista de mensajes geoespaciales desde el API Gateway (/api/messages)
   * Permite filtrar por coordenadas, radio y estado.
   */
  public async getMessages(
    params?: QueryMessagesParams
  ): Promise<{ success: boolean; data: GeoMessage[]; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.filterMockMessages(params) };
    }

    try {
      // Construir query string si se especifican filtros
      const queryParts: string[] = [];
      if (params?.latitude !== undefined) queryParts.push(`lat=${params.latitude}`);
      if (params?.longitude !== undefined) queryParts.push(`lng=${params.longitude}`);
      if (params?.radiusMeters !== undefined) queryParts.push(`radius=${params.radiusMeters}`);
      if (params?.status && params.status !== 'todos') queryParts.push(`status=${params.status}`);

      const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : '';
      const endpoint = `${API_CONFIG.ROUTES.MESSAGES.GET_ALL}${queryString}`;

      const response = await apiClient.get<GeoMessage[]>(endpoint);

      if (response.success && response.data) {
        return { success: true, data: response.data };
      }

      return {
        success: false,
        data: [],
        error: response.message || 'No se pudieron recuperar los mensajes.',
      };
    } catch (error: any) {
      console.warn(
        `[MessagesService] Error al conectar con el Gateway (${API_CONFIG.ROUTES.MESSAGES.GET_ALL}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK) {
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
      const response = await apiClient.post<GeoMessage>(
        API_CONFIG.ROUTES.MESSAGES.CREATE,
        {
          ...dto,
          authorId: author.id,
          authorName: author.username,
          authorColor: author.color,
        }
      );

      if (response.success && response.data) {
        return { success: true, data: response.data };
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

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK) {
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

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK) {
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
