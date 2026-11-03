import { API_CONFIG, deriveWsBaseUrl } from '../../config/api.config';
import { apiClient } from '../api/apiClient';
import {
  RealtimeEventFrame,
  RealtimeEventName,
  SocketTicketResponse,
} from '../../types';

type MockListener = (frame: RealtimeEventFrame) => void;

/**
 * Servicio encargado de obtener tickets efímeros para el handshake WebSocket
 * y construir la URL de conexión hacia el API Gateway (`/api/ws?ticket=...`).
 *
 * Incluye un bus en memoria cuando `API_CONFIG.USE_MOCKS` está activo.
 */
class SocketService {
  private mockListeners = new Set<MockListener>();

  /**
   * Solicita un ticket efímero de un solo uso (TTL 60 s) al Gateway:
   * POST /api/socket/tickets (con Authorization: Bearer <JWT>)
   */
  public async requestTicket(): Promise<SocketTicketResponse> {
    if (API_CONFIG.USE_MOCKS) {
      return {
        ticket: `mock-ticket-${Date.now().toString(36)}`,
        expiresIn: 60,
      };
    }

    const data = await apiClient.requestRaw<SocketTicketResponse>(
      API_CONFIG.ROUTES.SOCKET.TICKETS,
      { method: 'POST' }
    );

    if (!data || typeof data.ticket !== 'string' || !data.ticket) {
      throw new Error('El servidor no devolvió un ticket WebSocket válido.');
    }

    return data;
  }

  /**
   * Construye la URL WebSocket completa con el ticket efímero en el query string.
   */
  public buildWebSocketUrl(ticket: string): string {
    const wsBase = deriveWsBaseUrl(apiClient.getBaseUrl() || API_CONFIG.BASE_URL);
    return `${wsBase}${API_CONFIG.ROUTES.SOCKET.WS}?ticket=${encodeURIComponent(ticket)}`;
  }

  /**
   * Suscribe un listener al bus simulado local (modo Mock).
   */
  public onMockEvent(listener: MockListener): () => void {
    this.mockListeners.add(listener);
    return () => {
      this.mockListeners.delete(listener);
    };
  }

  /**
   * Emite un evento simulado en modo Mock para pruebas de interfaz.
   */
  public emitMockEvent<T = any>(event: RealtimeEventName, payload: T, eventId?: string): void {
    const frame: RealtimeEventFrame<T> = {
      type: 'event',
      eventId: eventId || `mock-evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      event,
      occurredAt: new Date().toISOString(),
      payload,
    };

    this.mockListeners.forEach((listener) => {
      try {
        listener(frame);
      } catch (err) {
        console.warn('[SocketService] Error en listener mock:', err);
      }
    });
  }
}

export const socketService = new SocketService();
