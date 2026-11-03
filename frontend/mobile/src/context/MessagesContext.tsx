import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { GeoMessage, MessageStatus, ModerationStatus, LocationCoords } from '../types';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';
import {
  messagesService,
  mapBackendMessageStatus,
} from '../services/messages/messagesService';
import { apiClient } from '../services/api/apiClient';
import { BOGOTA_SEED_MESSAGES } from '../data/bogotaMessages';
import { API_CONFIG } from '../config/api.config';
import { nintendoTheme } from '../theme/nintendoTheme';

// Radio de búsqueda en el servidor: el mayor rango seleccionable en el mapa.
// El mapa filtra después por el rango que elija el usuario.
const SEARCH_RADIUS_METERS = 500;

interface MessagesContextType {
  messages: GeoMessage[];
  activeMessages: GeoMessage[];
  isLoading: boolean;
  error: string | null;
  refreshMessages: () => Promise<void>;
  createMessage: (
    content: string,
    coords: LocationCoords,
    customStatus?: MessageStatus,
    expirationHours?: number
  ) => Promise<{ success: boolean; error?: string }>;
  deleteMessage: (messageId: string) => Promise<{ success: boolean; error?: string }>;
  rateMessage: (
    messageId: string,
    vote: 'LIKE' | 'DISLIKE'
  ) => Promise<{ success: boolean; error?: string }>;
  selectedMessage: GeoMessage | null;
  setSelectedMessage: (message: GeoMessage | null) => void;
  statusFilter: MessageStatus | 'todos';
  setStatusFilter: (filter: MessageStatus | 'todos') => void;
  /** Punto alrededor del cual se consultan los mensajes (ubicación del usuario) */
  setSearchCenter: (coords: LocationCoords) => void;
}

const MessagesContext = createContext<MessagesContextType | undefined>(undefined);

export const MessagesProvider = ({ children }: { children: ReactNode }) => {
  const { user } = useAuth();
  const { onEvent, onReconnected, subscribeTopic, pushToast } = useRealtime();
  // Con el backend real se parte vacío; los datos de ejemplo son solo del modo simulado
  const [messages, setMessages] = useState<GeoMessage[]>(
    API_CONFIG.USE_MOCKS ? BOGOTA_SEED_MESSAGES : []
  );
  const [searchCenter, setSearchCenter] = useState<LocationCoords | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<GeoMessage | null>(null);
  const [statusFilter, setStatusFilter] = useState<MessageStatus | 'todos'>('todos');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMessages = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await messagesService.getMessages({
        status: statusFilter === 'todos' ? undefined : statusFilter,
        latitude: searchCenter?.latitude,
        longitude: searchCenter?.longitude,
        radiusMeters: SEARCH_RADIUS_METERS,
        currentUser: user,
      });
      if (!response.success) {
        setError(response.error || 'No se pudieron recuperar los mensajes.');
      } else if (!API_CONFIG.USE_MOCKS || response.data.length > 0) {
        let loaded = response.data;
        if (!API_CONFIG.USE_MOCKS && user && loaded.length > 0) {
          try {
            const ids = loaded.slice(0, 100).map((m) => m.id);
            const batchSummaries = await apiClient.requestRaw<any[]>(
              API_CONFIG.ROUTES.RATINGS.BATCH,
              {
                method: 'POST',
                body: JSON.stringify({ messageIds: ids }),
              }
            );
            if (Array.isArray(batchSummaries)) {
              const mapById = new Map<string, any>();
              batchSummaries.forEach((s) => {
                if (s && s.messageId) mapById.set(String(s.messageId), s);
              });
              loaded = loaded.map((m) => {
                const s = mapById.get(m.id);
                if (!s) return m;
                return {
                  ...m,
                  likes: typeof s.likes === 'number' ? s.likes : m.likes,
                  dislikes: typeof s.dislikes === 'number' ? s.dislikes : m.dislikes,
                  score: typeof s.score === 'number' ? s.score : m.score,
                  myRating:
                    s.userRating === 'LIKE' || s.userRating === 'DISLIKE'
                      ? s.userRating
                      : null,
                };
              });
            }
          } catch {
            // Si rating no está disponible aún, continuamos con los mensajes sin votos
          }
        }
        setMessages((prev) => {
          const loadedById = new Map<string, GeoMessage>();
          loaded.forEach((m) => loadedById.set(m.id, m));
          const merged: GeoMessage[] = [...loaded];
          prev.forEach((existing) => {
            if (!loadedById.has(existing.id) && existing.status !== 'eliminado') {
              merged.push(existing);
            }
          });
          return merged;
        });
      }
    } catch (err: any) {
      console.warn('[MessagesContext] Error al consultar mensajes en el Gateway:', err.message);
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter, searchCenter, user]);

  useEffect(() => {
    fetchMessages();
  }, [fetchMessages]);

  // Reconciliación HTTP automática cuando el WebSocket se reconecta
  useEffect(() => {
    return onReconnected(() => {
      fetchMessages();
    });
  }, [onReconnected, fetchMessages]);

  // Suscripción al tópico del mensaje seleccionado (`message:<id>`) mientras está abierto
  useEffect(() => {
    if (!selectedMessage?.id) return;
    return subscribeTopic(`message:${selectedMessage.id}`);
  }, [selectedMessage?.id, subscribeTopic]);

  // Manejo de eventos en tiempo real (`message.published.v1`, `moderation.completed.v1`, `rating.changed.v1`)
  useEffect(() => {
    const unsubPublished = onEvent('message.published.v1', ({ payload }) => {
      if (!payload || !payload.messageId) return;
      const msgId = String(payload.messageId);
      const authorId = String(payload.authorId || '');
      const decision = (payload.moderationDecision || 'ALLOW') as ModerationStatus;

      setMessages((prev) => {
        const exists = prev.some((m) => m.id === msgId);
        if (exists) {
          return prev.map((m) =>
            m.id === msgId
              ? {
                  ...m,
                  status: 'publicado' as MessageStatus,
                  moderationStatus: decision,
                }
              : m
          );
        }

        if (
          typeof payload.latitude !== 'number' ||
          typeof payload.longitude !== 'number'
        ) {
          return prev;
        }

        const isMine = !!user && authorId === user.id;
        const palette = nintendoTheme.colors.avatarColors;
        let hash = 0;
        for (const ch of authorId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
        const fallbackColor = palette[hash % palette.length];

        const publishedAt = payload.publishedAt
          ? new Date(payload.publishedAt)
          : new Date();

        const newMsg: GeoMessage = {
          id: msgId,
          authorId,
          authorName: isMine ? user!.username : `Explorador ${authorId.slice(0, 4)}`,
          authorColor: isMine ? user!.color : fallbackColor,
          content: String(payload.contentPreview || '').slice(0, 140),
          latitude: payload.latitude,
          longitude: payload.longitude,
          createdAt: publishedAt.toISOString(),
          expiresAt: new Date(publishedAt.getTime() + 24 * 3600 * 1000).toISOString(),
          status: 'publicado',
          moderationStatus: decision,
        };

        return [newMsg, ...prev];
      });
    });

    const unsubModeration = onEvent('moderation.completed.v1', ({ payload }) => {
      if (!payload || !payload.messageId) return;
      const msgId = String(payload.messageId);
      const decision = String(payload.decision || 'ALLOW').toUpperCase() as ModerationStatus;
      const nextStatus = mapBackendMessageStatus(
        decision === 'BLOCK' ? 'BLOCKED' : decision === 'REVIEW' ? 'PENDING' : 'PUBLISHED',
        decision
      );

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                status: nextStatus,
                moderationStatus: decision,
              }
            : m
        )
      );

      setSelectedMessage((prev) =>
        prev && prev.id === msgId
          ? {
              ...prev,
              status: nextStatus,
              moderationStatus: decision,
            }
          : prev
      );
    });

    const unsubRating = onEvent('rating.changed.v1', ({ payload }) => {
      if (!payload || !payload.messageId) return;
      const msgId = String(payload.messageId);
      const likes = typeof payload.likes === 'number' ? payload.likes : undefined;
      const dislikes = typeof payload.dislikes === 'number' ? payload.dislikes : undefined;
      const score =
        likes !== undefined && dislikes !== undefined ? likes - dislikes : undefined;

      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId
            ? {
                ...m,
                likes: likes ?? m.likes,
                dislikes: dislikes ?? m.dislikes,
                score: score ?? m.score,
              }
            : m
        )
      );

      setSelectedMessage((prev) =>
        prev && prev.id === msgId
          ? {
              ...prev,
              likes: likes ?? prev.likes,
              dislikes: dislikes ?? prev.dislikes,
              score: score ?? prev.score,
            }
          : prev
      );
    });

    const unsubDeleted = onEvent('message.deleted.v1', ({ payload }) => {
      if (!payload || !payload.messageId) return;
      const msgId = String(payload.messageId);
      const authorId = String(payload.authorId || '');

      setMessages((prev) => {
        const found = prev.find((m) => m.id === msgId && m.status !== 'eliminado');
        if (found && (!user || authorId !== user.id)) {
          pushToast(
            'PictoNota eliminada',
            'Un explorador retiró una nota dentro de tu radar.',
            'warning'
          );
        }
        return prev.map((m) =>
          m.id === msgId ? { ...m, status: 'eliminado' as MessageStatus } : m
        );
      });

      setSelectedMessage((prev) => (prev && prev.id === msgId ? null : prev));
    });

    return () => {
      unsubPublished();
      unsubModeration();
      unsubRating();
      unsubDeleted();
    };
  }, [onEvent, user, pushToast]);

  const createMessage = async (
    content: string,
    coords: LocationCoords,
    customStatus: MessageStatus = 'publicado',
    expirationHours: number = 24
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para publicar un mensaje.' };
    }

    const trimmed = content.trim();
    if (!trimmed) {
      return { success: false, error: 'El mensaje no puede estar vacío.' };
    }

    if (trimmed.length > 140) {
      return { success: false, error: 'El mensaje no puede superar los 140 caracteres.' };
    }

    try {
      const result = await messagesService.createMessage(
        {
          content: trimmed,
          latitude: coords.latitude,
          longitude: coords.longitude,
          status: customStatus,
          expirationHours,
        },
        {
          id: user.id,
          username: user.username,
          color: user.color,
        }
      );

      if (result.success && result.data) {
        setMessages((prev) => [result.data!, ...prev]);
        return { success: true };
      }

      return {
        success: false,
        error: result.error || 'No se pudo publicar la nota en el API Gateway.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error al comunicarse con el microservicio de mensajes.',
      };
    }
  };

  const deleteMessage = async (
    messageId: string
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para realizar esta acción.' };
    }

    const target = messages.find((m) => m.id === messageId);
    if (!target) {
      return { success: false, error: 'Mensaje no encontrado.' };
    }

    if (target.authorId !== user.id) {
      return {
        success: false,
        error: 'Solo el autor original tiene permiso para eliminar este mensaje.',
      };
    }

    try {
      const result = await messagesService.deleteMessage(messageId);

      if (result.success) {
        // Marcamos como eliminado según las reglas del dominio
        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId ? { ...m, status: 'eliminado' as MessageStatus } : m
          )
        );

        if (selectedMessage?.id === messageId) {
          setSelectedMessage((prev) => (prev ? { ...prev, status: 'eliminado' } : null));
        }

        return { success: true };
      }

      return {
        success: false,
        error: result.error || 'No se pudo eliminar el mensaje a través del Gateway.',
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error de comunicación con el servicio de mensajes.',
      };
    }
  };

  const rateMessage = async (
    messageId: string,
    vote: 'LIKE' | 'DISLIKE'
  ): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para calificar un mensaje.' };
    }

    const target = messages.find((m) => m.id === messageId);
    if (target && target.authorId === user.id) {
      return { success: false, error: 'No puedes calificar tu propio mensaje.' };
    }

    const isToggleOff = target?.myRating === vote;

    try {
      const summary = await apiClient.requestRaw<any>(
        API_CONFIG.ROUTES.RATINGS.BY_MESSAGE(messageId),
        isToggleOff
          ? { method: 'DELETE' }
          : {
              method: 'PUT',
              body: JSON.stringify({ value: vote }),
            }
      );

      if (summary) {
        const nextLikes = typeof summary.likes === 'number' ? summary.likes : target?.likes ?? 0;
        const nextDislikes =
          typeof summary.dislikes === 'number' ? summary.dislikes : target?.dislikes ?? 0;
        const nextMyRating: 'LIKE' | 'DISLIKE' | null =
          summary.userRating === 'LIKE' || summary.userRating === 'DISLIKE'
            ? summary.userRating
            : isToggleOff
            ? null
            : vote;

        setMessages((prev) =>
          prev.map((m) =>
            m.id === messageId
              ? {
                  ...m,
                  likes: nextLikes,
                  dislikes: nextDislikes,
                  score: nextLikes - nextDislikes,
                  myRating: nextMyRating,
                }
              : m
          )
        );

        setSelectedMessage((prev) =>
          prev && prev.id === messageId
            ? {
                ...prev,
                likes: nextLikes,
                dislikes: nextDislikes,
                score: nextLikes - nextDislikes,
                myRating: nextMyRating,
              }
            : prev
        );
      }

      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'No se pudo registrar tu calificación.',
      };
    }
  };

  // Filtrado de mensajes visibles
  const activeMessages = messages.filter((m) => {
    if (statusFilter === 'todos') {
      return m.status !== 'eliminado';
    }
    return m.status === statusFilter;
  });

  return (
    <MessagesContext.Provider
      value={{
        messages,
        activeMessages,
        isLoading,
        error,
        refreshMessages: fetchMessages,
        createMessage,
        deleteMessage,
        rateMessage,
        selectedMessage,
        setSelectedMessage,
        statusFilter,
        setStatusFilter,
        setSearchCenter,
      }}
    >
      {children}
    </MessagesContext.Provider>
  );
};

export const useMessages = (): MessagesContextType => {
  const context = useContext(MessagesContext);
  if (!context) {
    throw new Error('useMessages debe ser utilizado dentro de un MessagesProvider');
  }
  return context;
};
