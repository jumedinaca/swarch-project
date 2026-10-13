import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import { Friendship, FriendshipStatus, GraphQLFriendship } from '../../types';
import { INITIAL_MOCK_FRIENDSHIPS } from '../../data/mockNetworkData';

/**
 * El servicio de red social expone solo GraphQL (POST /api/network/graphql).
 * Este servicio traduce las respuestas GraphQL (camelCase, status en mayúsculas)
 * al modelo `Friendship` que usan el contexto y el modal de amigos.
 */

export interface NetworkOverview {
  friends: Friendship[];
  incoming: Friendship[];
  outgoing: Friendship[];
}

type Result<T = undefined> = { success: boolean; data?: T; error?: string };

/** Campos de una relación que se piden en todas las consultas */
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

/** Error de negocio devuelto por GraphQL (llega con HTTP 200 en `errors[]`) */
class GraphQLRequestError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GraphQLRequestError';
  }
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: { message: string; extensions?: { code?: string } }[];
}

function toFriendship(f: GraphQLFriendship): Friendship {
  return {
    id: f.id,
    user_a: f.userA,
    user_b: f.userB,
    status: f.status.toLowerCase() as FriendshipStatus,
    requested_by: f.requestedBy,
    created_at: f.createdAt,
    updated_at: f.updatedAt,
    other_user_id: f.otherUserId,
    sent_by_me: f.sentByMe,
  };
}

/**
 * Enriquecer la amistad calculando `other_user_id` y `sent_by_me`
 * con base en el usuario autenticado actual (usado por los datos simulados).
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
   * Ejecuta una operación GraphQL en el gateway. Lanza GraphQLRequestError si
   * la respuesta trae `errors`, y ApiError si el gateway no responde o rechaza
   * la petición (por ejemplo 401 sin token).
   */
  private async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    const response = await apiClient.post<GraphQLResponse<T>>(API_CONFIG.ROUTES.NETWORK.GRAPHQL, {
      query,
      variables,
    });

    const body = response.data;
    if (body?.errors?.length) {
      const [first] = body.errors;
      throw new GraphQLRequestError(first.message, first.extensions?.code);
    }
    if (!body?.data) {
      throw new GraphQLRequestError('Respuesta vacía del servicio de red social.');
    }
    return body.data;
  }

  /**
   * Ejecuta la operación real y, solo si el gateway no responde (error de red),
   * recurre a los datos simulados. Los errores de negocio se devuelven tal cual.
   */
  private async run<T>(
    operation: () => Promise<T>,
    fallback: () => Result<T>,
    defaultError: string
  ): Promise<Result<T>> {
    if (API_CONFIG.USE_MOCKS) {
      return fallback();
    }

    try {
      return { success: true, data: await operation() };
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        console.info('[NetworkService] Gateway no disponible: usando datos simulados.');
        return fallback();
      }
      console.warn('[NetworkService] Error en GraphQL:', error.message);
      return { success: false, error: error.message || defaultError };
    }
  }

  /**
   * Amigos, solicitudes recibidas y solicitudes enviadas en una sola petición GraphQL.
   */
  public async getNetwork(currentUserId?: string): Promise<Result<NetworkOverview>> {
    return this.run(
      async () => {
        const data = await this.graphql<{
          friends: GraphQLFriendship[];
          incomingRequests: GraphQLFriendship[];
          outgoingRequests: GraphQLFriendship[];
        }>(`
          query NetworkOverview {
            friends { ${FRIENDSHIP_FIELDS} }
            incomingRequests { ${FRIENDSHIP_FIELDS} }
            outgoingRequests { ${FRIENDSHIP_FIELDS} }
          }
        `);
        return {
          friends: data.friends.map(toFriendship),
          incoming: data.incomingRequests.map(toFriendship),
          outgoing: data.outgoingRequests.map(toFriendship),
        };
      },
      () => ({
        success: true,
        data: {
          friends: this.mockGetFriends(currentUserId),
          incoming: this.mockGetIncoming(currentUserId),
          outgoing: this.mockGetOutgoing(currentUserId),
        },
      }),
      'No se pudo obtener la información de amigos.'
    );
  }

  /** Envía una solicitud de amistad (mutación sendFriendRequest) */
  public async sendFriendRequest(
    recipientId: string,
    currentUserId?: string
  ): Promise<Result<Friendship>> {
    return this.run(
      async () => {
        const data = await this.graphql<{ sendFriendRequest: GraphQLFriendship }>(
          `mutation SendFriendRequest($recipientId: UUID!) {
            sendFriendRequest(recipientId: $recipientId) { ${FRIENDSHIP_FIELDS} }
          }`,
          { recipientId: recipientId.trim() }
        );
        return toFriendship(data.sendFriendRequest);
      },
      () => this.mockSendRequest(recipientId, currentUserId),
      'No se pudo enviar la solicitud de amistad.'
    );
  }

  /** Acepta una solicitud recibida (mutación acceptFriendRequest) */
  public async acceptFriendRequest(
    requestId: string,
    currentUserId?: string
  ): Promise<Result<Friendship>> {
    return this.run(
      async () => {
        const data = await this.graphql<{ acceptFriendRequest: GraphQLFriendship }>(
          `mutation AcceptFriendRequest($id: ID!) {
            acceptFriendRequest(id: $id) { ${FRIENDSHIP_FIELDS} }
          }`,
          { id: requestId }
        );
        return toFriendship(data.acceptFriendRequest);
      },
      () => this.mockAcceptRequest(requestId, currentUserId),
      'No se pudo aceptar la solicitud.'
    );
  }

  /** Rechaza una solicitud recibida (mutación rejectFriendRequest) */
  public async rejectFriendRequest(requestId: string): Promise<Result> {
    return this.run(
      async () => {
        await this.graphql(`mutation RejectFriendRequest($id: ID!) { rejectFriendRequest(id: $id) }`, {
          id: requestId,
        });
        return undefined;
      },
      () => this.mockDeleteRequest(requestId),
      'No se pudo rechazar la solicitud.'
    );
  }

  /** Cancela una solicitud enviada (mutación cancelFriendRequest) */
  public async cancelFriendRequest(requestId: string): Promise<Result> {
    return this.run(
      async () => {
        await this.graphql(`mutation CancelFriendRequest($id: ID!) { cancelFriendRequest(id: $id) }`, {
          id: requestId,
        });
        return undefined;
      },
      () => this.mockDeleteRequest(requestId),
      'No se pudo cancelar la solicitud.'
    );
  }

  /** Elimina una amistad (mutación removeFriend) */
  public async removeFriend(friendId: string, currentUserId?: string): Promise<Result> {
    return this.run(
      async () => {
        await this.graphql(`mutation RemoveFriend($friendId: UUID!) { removeFriend(friendId: $friendId) }`, {
          friendId,
        });
        return undefined;
      },
      () => this.mockRemoveFriend(friendId, currentUserId),
      'No se pudo eliminar al amigo.'
    );
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

  private mockSendRequest(recipientId: string, currentUserId?: string): Result<Friendship> {
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

  private mockAcceptRequest(requestId: string, currentUserId?: string): Result<Friendship> {
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

  private mockDeleteRequest(requestId: string): Result {
    this.mockFriendships = this.mockFriendships.filter((f) => f.id !== requestId);
    return { success: true };
  }

  private mockRemoveFriend(friendId: string, currentUserId?: string): Result {
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
