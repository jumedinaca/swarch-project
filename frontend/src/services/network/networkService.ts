import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import {
  Friendship,
  FriendshipListResponse,
  QueryFriendshipsParams,
  GraphQLDashboardData,
} from '../../types';
import { INITIAL_MOCK_FRIENDSHIPS } from '../../data/mockNetworkData';

/**
 * Enriquecer la amistad calculando `other_user_id` y `sent_by_me`
 * con base en el usuario autenticado actual.
 */
export function enrichFriendship(f: Friendship, currentUserId?: string): Friendship {
  const isUserA = currentUserId ? f.user_a === currentUserId : false;
  const otherUserId = isUserA ? f.user_b : f.user_a;
  const sentByMe = currentUserId ? f.requested_by === currentUserId : false;

  return {
    ...f,
    other_user_id: f.other_user_id || otherUserId,
    sent_by_me: f.sent_by_me !== undefined ? f.sent_by_me : sentByMe,
  };
}

class NetworkService {
  private mockFriendships: Friendship[] = [...INITIAL_MOCK_FRIENDSHIPS];

  /**
   * Obtiene la lista de amigos aceptados (GET /api/network/friends)
   */
  public async getFriends(
    currentUserId?: string,
    params?: QueryFriendshipsParams
  ): Promise<{ success: boolean; data: Friendship[]; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.mockGetFriends(currentUserId) };
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.set('limit', String(params.limit));
      if (params?.cursor) queryParams.set('cursor', params.cursor);

      const qs = queryParams.toString();
      const endpoint = `${API_CONFIG.ROUTES.NETWORK.FRIENDS}${qs ? `?${qs}` : ''}`;

      const response = await apiClient.get<FriendshipListResponse>(endpoint);

      if (response.success && response.data?.friendships) {
        return {
          success: true,
          data: response.data.friendships.map((f) => enrichFriendship(f, currentUserId)),
        };
      }

      return {
        success: false,
        data: [],
        error: response.message || 'No se pudo obtener la lista de amigos.',
      };
    } catch (error: any) {
      console.warn(
        `[NetworkService] Error al conectar con el Gateway (${API_CONFIG.ROUTES.NETWORK.FRIENDS}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[NetworkService] Activando fallback con amigos simulados locales.');
        return { success: true, data: this.mockGetFriends(currentUserId) };
      }

      return {
        success: false,
        data: [],
        error: error.message || 'Error de conexión con el servicio de red social.',
      };
    }
  }

  /**
   * Obtiene las solicitudes de amistad pendientes recibidas
   * (GET /api/network/request/incoming)
   */
  public async getIncomingRequests(
    currentUserId?: string,
    params?: QueryFriendshipsParams
  ): Promise<{ success: boolean; data: Friendship[]; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.mockGetIncoming(currentUserId) };
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.set('limit', String(params.limit));
      if (params?.cursor) queryParams.set('cursor', params.cursor);

      const qs = queryParams.toString();
      const endpoint = `${API_CONFIG.ROUTES.NETWORK.INCOMING_REQUESTS}${qs ? `?${qs}` : ''}`;

      const response = await apiClient.get<FriendshipListResponse>(endpoint);

      if (response.success && response.data?.friendships) {
        return {
          success: true,
          data: response.data.friendships.map((f) => enrichFriendship(f, currentUserId)),
        };
      }

      return {
        success: false,
        data: [],
        error: response.message || 'No se pudieron obtener las solicitudes recibidas.',
      };
    } catch (error: any) {
      console.warn(
        `[NetworkService] Error al conectar con Gateway (${API_CONFIG.ROUTES.NETWORK.INCOMING_REQUESTS}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[NetworkService] Fallback de solicitudes recibidas simuladas.');
        return { success: true, data: this.mockGetIncoming(currentUserId) };
      }

      return {
        success: false,
        data: [],
        error: error.message || 'Error al consultar solicitudes recibidas.',
      };
    }
  }

  /**
   * Obtiene las solicitudes de amistad pendientes enviadas
   * (GET /api/network/request/outcoming)
   */
  public async getOutgoingRequests(
    currentUserId?: string,
    params?: QueryFriendshipsParams
  ): Promise<{ success: boolean; data: Friendship[]; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.mockGetOutgoing(currentUserId) };
    }

    try {
      const queryParams = new URLSearchParams();
      if (params?.limit) queryParams.set('limit', String(params.limit));
      if (params?.cursor) queryParams.set('cursor', params.cursor);

      const qs = queryParams.toString();
      const endpoint = `${API_CONFIG.ROUTES.NETWORK.OUTCOMING_REQUESTS}${qs ? `?${qs}` : ''}`;

      const response = await apiClient.get<FriendshipListResponse>(endpoint);

      if (response.success && response.data?.friendships) {
        return {
          success: true,
          data: response.data.friendships.map((f) => enrichFriendship(f, currentUserId)),
        };
      }

      return {
        success: false,
        data: [],
        error: response.message || 'No se pudieron obtener las solicitudes enviadas.',
      };
    } catch (error: any) {
      console.warn(
        `[NetworkService] Error al conectar con Gateway (${API_CONFIG.ROUTES.NETWORK.OUTCOMING_REQUESTS}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[NetworkService] Fallback de solicitudes enviadas simuladas.');
        return { success: true, data: this.mockGetOutgoing(currentUserId) };
      }

      return {
        success: false,
        data: [],
        error: error.message || 'Error al consultar solicitudes enviadas.',
      };
    }
  }

  /**
   * Envía una nueva solicitud de amistad (POST /api/network/request)
   */
  public async sendFriendRequest(
    recipientId: string,
    currentUserId?: string
  ): Promise<{ success: boolean; data?: Friendship; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockSendRequest(recipientId, currentUserId);
    }

    try {
      const response = await apiClient.post<Friendship>(
        API_CONFIG.ROUTES.NETWORK.REQUEST,
        { recipient_id: recipientId }
      );

      if (response.success && response.data) {
        return {
          success: true,
          data: enrichFriendship(response.data, currentUserId),
        };
      }

      return {
        success: false,
        error: response.message || 'No se pudo enviar la solicitud de amistad.',
      };
    } catch (error: any) {
      console.warn(
        `[NetworkService] Error al enviar solicitud (${API_CONFIG.ROUTES.NETWORK.REQUEST}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockSendRequest(recipientId, currentUserId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al enviar la solicitud.',
      };
    }
  }

  /**
   * Acepta una solicitud de amistad recibida (POST /api/network/request/accept/:id)
   */
  public async acceptFriendRequest(
    requestId: string,
    currentUserId?: string
  ): Promise<{ success: boolean; data?: Friendship; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockAcceptRequest(requestId, currentUserId);
    }

    try {
      const response = await apiClient.post<Friendship>(
        API_CONFIG.ROUTES.NETWORK.ACCEPT_REQUEST(requestId)
      );

      if (response.success && response.data) {
        return {
          success: true,
          data: enrichFriendship(response.data, currentUserId),
        };
      }

      return {
        success: false,
        error: response.message || 'No se pudo aceptar la solicitud.',
      };
    } catch (error: any) {
      console.warn(`[NetworkService] Error al aceptar solicitud (${requestId}):`, error.message);

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockAcceptRequest(requestId, currentUserId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al aceptar la solicitud.',
      };
    }
  }

  /**
   * Rechaza una solicitud de amistad recibida (DELETE /api/network/request/reject/:id)
   */
  public async rejectFriendRequest(
    requestId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockDeleteRequest(requestId);
    }

    try {
      const response = await apiClient.delete(
        API_CONFIG.ROUTES.NETWORK.REJECT_REQUEST(requestId)
      );

      if (response.success) {
        return { success: true };
      }

      return {
        success: false,
        error: response.message || 'No se pudo rechazar la solicitud.',
      };
    } catch (error: any) {
      console.warn(`[NetworkService] Error al rechazar solicitud (${requestId}):`, error.message);

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockDeleteRequest(requestId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al rechazar la solicitud.',
      };
    }
  }

  /**
   * Cancela una solicitud enviada previamente (DELETE /api/network/request/cancel/:id)
   */
  public async cancelFriendRequest(
    requestId: string
  ): Promise<{ success: boolean; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockDeleteRequest(requestId);
    }

    try {
      const response = await apiClient.delete(
        API_CONFIG.ROUTES.NETWORK.CANCEL_REQUEST(requestId)
      );

      if (response.success) {
        return { success: true };
      }

      return {
        success: false,
        error: response.message || 'No se pudo cancelar la solicitud.',
      };
    } catch (error: any) {
      console.warn(`[NetworkService] Error al cancelar solicitud (${requestId}):`, error.message);

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockDeleteRequest(requestId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al cancelar la solicitud.',
      };
    }
  }

  /**
   * Elimina una amistad existente (DELETE /api/network/friends/:friendId)
   */
  public async removeFriend(
    friendId: string,
    currentUserId?: string
  ): Promise<{ success: boolean; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockRemoveFriend(friendId, currentUserId);
    }

    try {
      const response = await apiClient.delete(
        API_CONFIG.ROUTES.NETWORK.REMOVE_FRIEND(friendId)
      );

      if (response.success) {
        return { success: true };
      }

      return {
        success: false,
        error: response.message || 'No se pudo eliminar al amigo.',
      };
    } catch (error: any) {
      console.warn(`[NetworkService] Error al eliminar amigo (${friendId}):`, error.message);

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockRemoveFriend(friendId, currentUserId);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al eliminar amigo.',
      };
    }
  }

  /**
   * Ejecuta una consulta combinada vía GraphQL (POST /api/network/graphql)
   * Obtiene amigos y solicitudes en una sola petición HTTP.
   */
  public async getDashboardGraphQL(
    currentUserId?: string
  ): Promise<{ success: boolean; data?: GraphQLDashboardData; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return {
        success: true,
        data: {
          me: currentUserId,
          friends: this.mockGetFriends(currentUserId).map((f) => ({
            id: f.id,
            userA: f.user_a,
            userB: f.user_b,
            status: 'ACCEPTED',
            requestedBy: f.requested_by,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            otherUserId: f.other_user_id || (f.user_a === currentUserId ? f.user_b : f.user_a),
            sentByMe: f.requested_by === currentUserId,
          })),
          incomingRequests: this.mockGetIncoming(currentUserId).map((f) => ({
            id: f.id,
            userA: f.user_a,
            userB: f.user_b,
            status: 'PENDING',
            requestedBy: f.requested_by,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            otherUserId: f.other_user_id || (f.user_a === currentUserId ? f.user_b : f.user_a),
            sentByMe: false,
          })),
          outgoingRequests: this.mockGetOutgoing(currentUserId).map((f) => ({
            id: f.id,
            userA: f.user_a,
            userB: f.user_b,
            status: 'PENDING',
            requestedBy: f.requested_by,
            createdAt: f.created_at,
            updatedAt: f.updated_at,
            otherUserId: f.other_user_id || (f.user_a === currentUserId ? f.user_b : f.user_a),
            sentByMe: true,
          })),
        },
      };
    }

    try {
      const query = `
        query Dashboard {
          me
          friends {
            id
            userA
            userB
            status
            requestedBy
            createdAt
            updatedAt
            otherUserId
            sentByMe
          }
          incomingRequests {
            id
            userA
            userB
            status
            requestedBy
            createdAt
            updatedAt
            otherUserId
            sentByMe
          }
          outgoingRequests {
            id
            userA
            userB
            status
            requestedBy
            createdAt
            updatedAt
            otherUserId
            sentByMe
          }
        }
      `;

      const response = await apiClient.post<{ data: GraphQLDashboardData; errors?: any[] }>(
        API_CONFIG.ROUTES.NETWORK.GRAPHQL,
        { query }
      );

      if (response.success && response.data) {
        const gqlData = (response.data as any).data || response.data;
        return { success: true, data: gqlData };
      }

      return {
        success: false,
        error: response.message || 'Error en consulta GraphQL de red social.',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Error al ejecutar GraphQL en el gateway.',
      };
    }
  }

  // ==========================================
  // Métodos de simulación (Mock / Fallback)
  // ==========================================

  private mockGetFriends(currentUserId?: string): Friendship[] {
    return this.mockFriendships
      .filter((f) => {
        if (f.status !== 'accepted') return false;
        if (!currentUserId) return true;
        return f.user_a === currentUserId || f.user_b === currentUserId;
      })
      .map((f) => enrichFriendship(f, currentUserId));
  }

  private mockGetIncoming(currentUserId?: string): Friendship[] {
    return this.mockFriendships
      .filter((f) => {
        if (f.status !== 'pending') return false;
        if (!currentUserId) return true;
        return (
          (f.user_a === currentUserId || f.user_b === currentUserId) &&
          f.requested_by !== currentUserId
        );
      })
      .map((f) => enrichFriendship(f, currentUserId));
  }

  private mockGetOutgoing(currentUserId?: string): Friendship[] {
    return this.mockFriendships
      .filter((f) => {
        if (f.status !== 'pending') return false;
        if (!currentUserId) return true;
        return f.requested_by === currentUserId;
      })
      .map((f) => enrichFriendship(f, currentUserId));
  }

  private mockSendRequest(
    recipientId: string,
    currentUserId?: string
  ): { success: boolean; data?: Friendship; error?: string } {
    const userA = currentUserId || 'user-demo-1';
    const userB = recipientId.trim();

    if (userA === userB) {
      return { success: false, error: 'No puedes enviarte una solicitud a ti mismo.' };
    }

    const existing = this.mockFriendships.find(
      (f) =>
        (f.user_a === userA && f.user_b === userB) ||
        (f.user_a === userB && f.user_b === userA)
    );

    if (existing) {
      if (existing.status === 'accepted') {
        return { success: false, error: 'Ya eres amigo de este usuario.' };
      }
      return { success: false, error: 'Ya existe una solicitud pendiente con este usuario.' };
    }

    const newFriendship: Friendship = {
      id: `req-mock-${Date.now()}`,
      user_a: userA < userB ? userA : userB,
      user_b: userA < userB ? userB : userA,
      status: 'pending',
      requested_by: userA,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      other_user_id: userB,
      sent_by_me: true,
    };

    this.mockFriendships.push(newFriendship);
    return { success: true, data: newFriendship };
  }

  private mockAcceptRequest(
    requestId: string,
    currentUserId?: string
  ): { success: boolean; data?: Friendship; error?: string } {
    const index = this.mockFriendships.findIndex((f) => f.id === requestId);
    if (index === -1) {
      return { success: false, error: 'Solicitud no encontrada.' };
    }

    this.mockFriendships[index] = {
      ...this.mockFriendships[index],
      status: 'accepted',
      updated_at: new Date().toISOString(),
    };

    return {
      success: true,
      data: enrichFriendship(this.mockFriendships[index], currentUserId),
    };
  }

  private mockDeleteRequest(requestId: string): { success: boolean } {
    this.mockFriendships = this.mockFriendships.filter((f) => f.id !== requestId);
    return { success: true };
  }

  private mockRemoveFriend(friendId: string, currentUserId?: string): { success: boolean } {
    const me = currentUserId || 'user-demo-1';
    this.mockFriendships = this.mockFriendships.filter((f) => {
      const isPair =
        (f.user_a === me && f.user_b === friendId) ||
        (f.user_a === friendId && f.user_b === me);
      return !isPair;
    });
    return { success: true };
  }
}

export const networkService = new NetworkService();
