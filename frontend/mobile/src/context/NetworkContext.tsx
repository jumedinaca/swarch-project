import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { Friendship, UserProfile } from '../types';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';
import { networkService } from '../services/network/networkService';
import { profileService } from '../services/profile/profileService';
import { validateRecipientId } from '../utils/validators';
import { API_CONFIG } from '../config/api.config';

export type RelationshipStatus = 'self' | 'friend' | 'incoming' | 'outgoing' | 'none';

function otherUserId(friendship: Friendship, currentUserId: string): string {
  if (friendship.other_user_id) return friendship.other_user_id;
  return friendship.user_a === currentUserId ? friendship.user_b : friendship.user_a;
}

async function attachProfiles(
  friendships: Friendship[],
  currentUserId: string
): Promise<Friendship[]> {
  if (friendships.length === 0) return friendships;
  const ids = friendships.map((friendship) => otherUserId(friendship, currentUserId));
  const profilesList = await profileService.getBatch(ids);
  const profiles = new Map<string, UserProfile>(
    Array.isArray(profilesList) ? profilesList.map((p) => [p.userId, p]) : []
  );
  return friendships.map((friendship) => ({
    ...friendship,
    profile: profiles.get(otherUserId(friendship, currentUserId)) ?? friendship.profile ?? null,
  }));
}

interface NetworkContextType {
  friends: Friendship[];
  incomingRequests: Friendship[];
  outgoingRequests: Friendship[];
  pendingCount: number;
  isLoading: boolean;
  error: string | null;
  refreshNetwork: () => Promise<void>;
  sendFriendRequest: (recipientId: string) => Promise<{ success: boolean; error?: string }>;
  acceptFriendRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  rejectFriendRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  cancelFriendRequest: (requestId: string) => Promise<{ success: boolean; error?: string }>;
  removeFriend: (friendId: string) => Promise<{ success: boolean; error?: string }>;
  isFriend: (userId: string) => boolean;
  hasPendingRequestWith: (userId: string) => boolean;
  getRelationshipStatus: (userId: string) => RelationshipStatus;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export const NetworkProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { onEvent, onReconnected } = useRealtime();

  const [friends, setFriends] = useState<Friendship[]>([]);
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  const [outgoingRequests, setOutgoingRequests] = useState<Friendship[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchNetwork = useCallback(async () => {
    if (!user) {
      setFriends([]);
      setIncomingRequests([]);
      setOutgoingRequests([]);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // Una sola petición GraphQL trae amigos y solicitudes recibidas y enviadas
      const res = await networkService.getNetwork(user.id);

      if (res.success && res.data) {
        const [friends, incoming, outgoing] = await Promise.all([
          attachProfiles(res.data.friends, user.id),
          attachProfiles(res.data.incoming, user.id),
          attachProfiles(res.data.outgoing, user.id),
        ]);
        setFriends(friends);
        setIncomingRequests(incoming);
        setOutgoingRequests(outgoing);
      } else if (res.error) {
        setError(res.error);
      }
    } catch (err: any) {
      console.warn('[NetworkContext] Error al actualizar red social:', err.message);
      setError(err.message || 'Error al obtener datos de la red social.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchNetwork();
  }, [fetchNetwork]);

  // Reconciliación HTTP automática al reconectarse el WebSocket
  useEffect(() => {
    return onReconnected(() => {
      fetchNetwork();
    });
  }, [onReconnected, fetchNetwork]);

  // Actualización en tiempo real ante actividad de amistad o notificaciones
  useEffect(() => {
    const unsubActivity = onEvent('activity.created.v1', () => {
      fetchNetwork();
    });
    const unsubNotification = onEvent('notification.requested.v1', () => {
      fetchNetwork();
    });
    return () => {
      unsubActivity();
      unsubNotification();
    };
  }, [onEvent, fetchNetwork]);

  const isFriend = useCallback(
    (userId: string): boolean => {
      if (!userId || !user) return false;
      const target = userId.trim().toLowerCase();
      return friends.some(
        (f) =>
          f.other_user_id?.toLowerCase() === target ||
          f.user_a.toLowerCase() === target ||
          f.user_b.toLowerCase() === target
      );
    },
    [friends, user]
  );

  const hasPendingRequestWith = useCallback(
    (userId: string): boolean => {
      if (!userId || !user) return false;
      const target = userId.trim().toLowerCase();
      const inIncoming = incomingRequests.some(
        (f) =>
          f.other_user_id?.toLowerCase() === target ||
          f.requested_by.toLowerCase() === target
      );
      const inOutgoing = outgoingRequests.some(
        (f) =>
          f.other_user_id?.toLowerCase() === target ||
          f.user_a.toLowerCase() === target ||
          f.user_b.toLowerCase() === target
      );
      return inIncoming || inOutgoing;
    },
    [incomingRequests, outgoingRequests, user]
  );

  const getRelationshipStatus = useCallback(
    (userId: string): RelationshipStatus => {
      if (!userId || !user) return 'none';
      const target = userId.trim().toLowerCase();
      if (user.id.toLowerCase() === target) return 'self';

      if (isFriend(target)) return 'friend';

      const isIncoming = incomingRequests.some(
        (f) =>
          f.other_user_id?.toLowerCase() === target ||
          f.requested_by.toLowerCase() === target
      );
      if (isIncoming) return 'incoming';

      const isOutgoing = outgoingRequests.some(
        (f) =>
          f.other_user_id?.toLowerCase() === target ||
          f.user_a.toLowerCase() === target ||
          f.user_b.toLowerCase() === target
      );
      if (isOutgoing) return 'outgoing';

      return 'none';
    },
    [user, isFriend, incomingRequests, outgoingRequests]
  );

  const sendFriendRequest = async (
    recipientId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para agregar amigos.' };
    }

    const validation = validateRecipientId(
      recipientId,
      user.id,
      API_CONFIG.USE_MOCKS
    );
    if (!validation.isValid) {
      return { success: false, error: validation.error };
    }

    const cleanRecipientId = recipientId.trim();

    if (isFriend(cleanRecipientId)) {
      return { success: false, error: 'Este usuario ya está en tu lista de amigos.' };
    }

    if (hasPendingRequestWith(cleanRecipientId)) {
      return {
        success: false,
        error: 'Ya existe una solicitud de amistad pendiente con este usuario.',
      };
    }

    try {
      const res = await networkService.sendFriendRequest(cleanRecipientId, user.id);
      if (res.success && res.data) {
        const [enriched] = await attachProfiles([res.data], user.id);
        setOutgoingRequests((prev) => [enriched, ...prev]);
        return { success: true };
      }
      return {
        success: false,
        error: res.error || 'No se pudo enviar la solicitud.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'No se pudo conectar con la red social.',
      };
    }
  };

  const acceptFriendRequest = async (
    requestId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para realizar esta acción.' };
    }

    try {
      const res = await networkService.acceptFriendRequest(requestId, user.id);
      if (res.success && res.data) {
        const [enriched] = await attachProfiles([res.data], user.id);
        setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId));
        setFriends((prev) => [enriched, ...prev]);
        return { success: true };
      }
      return {
        success: false,
        error: res.error || 'No se pudo aceptar la solicitud.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al aceptar la solicitud.',
      };
    }
  };

  const rejectFriendRequest = async (
    requestId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para realizar esta acción.' };
    }

    try {
      const res = await networkService.rejectFriendRequest(requestId);
      if (res.success) {
        setIncomingRequests((prev) => prev.filter((r) => r.id !== requestId));
        return { success: true };
      }
      return {
        success: false,
        error: res.error || 'No se pudo rechazar la solicitud.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al rechazar la solicitud.',
      };
    }
  };

  const cancelFriendRequest = async (
    requestId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para realizar esta acción.' };
    }

    try {
      const res = await networkService.cancelFriendRequest(requestId);
      if (res.success) {
        setOutgoingRequests((prev) => prev.filter((r) => r.id !== requestId));
        return { success: true };
      }
      return {
        success: false,
        error: res.error || 'No se pudo cancelar la solicitud.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al cancelar la solicitud.',
      };
    }
  };

  const removeFriend = async (
    friendId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para realizar esta acción.' };
    }

    try {
      const res = await networkService.removeFriend(friendId, user.id);
      if (res.success) {
        setFriends((prev) =>
          prev.filter(
            (f) =>
              f.other_user_id !== friendId &&
              f.user_a !== friendId &&
              f.user_b !== friendId
          )
        );
        return { success: true };
      }
      return {
        success: false,
        error: res.error || 'No se pudo eliminar al amigo.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al eliminar al amigo.',
      };
    }
  };

  return (
    <NetworkContext.Provider
      value={{
        friends,
        incomingRequests,
        outgoingRequests,
        pendingCount: incomingRequests.length,
        isLoading,
        error,
        refreshNetwork: fetchNetwork,
        sendFriendRequest,
        acceptFriendRequest,
        rejectFriendRequest,
        cancelFriendRequest,
        removeFriend,
        isFriend,
        hasPendingRequestWith,
        getRelationshipStatus,
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
};

export const useNetwork = (): NetworkContextType => {
  const context = useContext(NetworkContext);
  if (!context) {
    throw new Error('useNetwork debe ser utilizado dentro de un NetworkProvider');
  }
  return context;
};
