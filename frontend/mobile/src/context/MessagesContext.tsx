import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  GeoMessage,
  MessageStatus,
  ModerationStatus,
  LocationCoords,
  UserProfile,
  RatingSummary,
} from '../types';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';
import { useProfile } from './ProfileContext';
import {
  messagesService,
  mapBackendMessageStatus,
} from '../services/messages/messagesService';
import {
  profileService,
  colorForUserId,
} from '../services/profile/profileService';
import { ratingService } from '../services/rating/ratingService';
import { BOGOTA_SEED_MESSAGES } from '../data/bogotaMessages';
import { API_CONFIG } from '../config/api.config';

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
  const { myProfile, resolveProfiles } = useProfile();
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
      const currentAuthor = user
        ? {
            id: user.id,
            username: user.username,
            displayName: myProfile?.displayName ?? null,
            color: myProfile?.color || user.color || colorForUserId(user.id),
            avatarUrl: myProfile?.avatarUrl ?? null,
          }
        : null;

      const response = await messagesService.getMessages({
        status: statusFilter === 'todos' ? undefined : statusFilter,
        latitude: searchCenter?.latitude,
        longitude: searchCenter?.longitude,
        radiusMeters: SEARCH_RADIUS_METERS,
        currentUser: currentAuthor,
      });

      if (!response.success) {
        setError(response.error || 'No se pudieron recuperar los mensajes.');
      } else if (!API_CONFIG.USE_MOCKS || response.data.length > 0) {
        let loaded = response.data;

        if (loaded.length > 0 && user) {
          const messageIds = loaded.slice(0, 100).map((m) => m.id);
          const authorIds = Array.from(
            new Set(loaded.slice(0, 100).map((m) => m.authorId).filter(Boolean))
          );

          // Consultar perfiles de autores y calificaciones de mensajes en paralelo (sin N+1)
          const [profilesMap, batchRatings] = await Promise.all([
            resolveProfiles(authorIds).catch(() => ({} as Record<string, UserProfile>)),
            ratingService.getBatchRatings(messageIds).catch(() => [] as RatingSummary[]),
          ]);

          const ratingsById = new Map<string, RatingSummary>();
          batchRatings.forEach((r) => {
            if (r && r.messageId) {
              ratingsById.set(String(r.messageId), r);
            }
          });

          loaded = loaded.map((m) => {
            const profile = profilesMap[m.authorId];
            const rating = ratingsById.get(m.id);

            return {
              ...m,
              authorName: profile
                ? profile.displayName || profile.username
                : m.authorName,
              authorColor: profile?.color || m.authorColor,
              authorAvatarUrl:
                profile?.avatarUrl !== undefined ? profile.avatarUrl : m.authorAvatarUrl,
              likes: rating ? rating.likes : m.likes ?? 0,
              dislikes: rating ? rating.dislikes : m.dislikes ?? 0,
              score: rating ? rating.score : m.score ?? 0,
              myRating: rating ? rating.myRating : m.myRating ?? null,
            };
          });
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
  }, [statusFilter, searchCenter, user, myProfile, resolveProfiles]);

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

  // Manejo de eventos en tiempo real (`message.published.v1`, `moderation.completed.v1`, `rating.changed.v1`, `profile.updated.v1`)
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
        const fallbackColor = colorForUserId(authorId);
        const publishedAt = payload.publishedAt
          ? new Date(payload.publishedAt)
          : new Date();

        const newMsg: GeoMessage = {
          id: msgId,
          authorId,
          authorName: isMine
            ? myProfile?.displayName || user!.username
            : `Explorador ${authorId.slice(0, 4)}`,
          authorColor: isMine
            ? myProfile?.color || user!.color || fallbackColor
            : fallbackColor,
          authorAvatarUrl: isMine ? myProfile?.avatarUrl ?? null : null,
          content: String(payload.contentPreview || '').slice(0, 140),
          latitude: payload.latitude,
          longitude: payload.longitude,
          createdAt: publishedAt.toISOString(),
          expiresAt: new Date(publishedAt.getTime() + 24 * 3600 * 1000).toISOString(),
          status: 'publicado',
          moderationStatus: decision,
          likes: 0,
          dislikes: 0,
          score: 0,
          myRating: null,
        };

        // Resolver asíncronamente el perfil del autor si es otro explorador
        if (!isMine && authorId) {
          profileService
            .getById(authorId)
            .then((prof) => {
              if (!prof) return;
              setMessages((curr) =>
                curr.map((m) =>
                  m.id === msgId
                    ? {
                        ...m,
                        authorName: prof.displayName || prof.username,
                        authorColor: prof.color || m.authorColor,
                        authorAvatarUrl: prof.avatarUrl ?? m.authorAvatarUrl,
                      }
                    : m
                )
              );
            })
            .catch(() => {});
        }

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

    const unsubProfile = onEvent('profile.updated.v1', ({ payload }) => {
      if (!payload || !payload.userId) return;
      const updatedUserId = String(payload.userId);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.authorId !== updatedUserId) return m;
          return {
            ...m,
            authorName:
              typeof payload.displayName === 'string' && payload.displayName.trim() !== ''
                ? payload.displayName
                : m.authorName,
            authorColor:
              typeof payload.color === 'string' && payload.color.trim() !== ''
                ? payload.color
                : m.authorColor,
            authorAvatarUrl:
              payload.avatarUrl !== undefined ? payload.avatarUrl : m.authorAvatarUrl,
          };
        })
      );

      setSelectedMessage((prev) => {
        if (!prev || prev.authorId !== updatedUserId) return prev;
        return {
          ...prev,
          authorName:
            typeof payload.displayName === 'string' && payload.displayName.trim() !== ''
              ? payload.displayName
              : prev.authorName,
          authorColor:
            typeof payload.color === 'string' && payload.color.trim() !== ''
              ? payload.color
              : prev.authorColor,
          authorAvatarUrl:
            payload.avatarUrl !== undefined ? payload.avatarUrl : prev.authorAvatarUrl,
        };
      });
    });

    return () => {
      unsubPublished();
      unsubModeration();
      unsubRating();
      unsubDeleted();
      unsubProfile();
    };
  }, [onEvent, user, myProfile, pushToast]);

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
          displayName: myProfile?.displayName ?? null,
          color: myProfile?.color || user.color || colorForUserId(user.id),
          avatarUrl: myProfile?.avatarUrl ?? null,
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

    if (target && target.status !== 'publicado') {
      return {
        success: false,
        error: 'Solo se pueden calificar mensajes publicados.',
      };
    }

    const prevLikes = target?.likes ?? 0;
    const prevDislikes = target?.dislikes ?? 0;
    const prevMyRating = target?.myRating ?? null;
    const isToggleOff = prevMyRating === vote;
    const nextOptimisticVote: 'LIKE' | 'DISLIKE' | null = isToggleOff ? null : vote;

    // Calcular conteos optimistas inmediatos
    let optLikes = prevLikes;
    let optDislikes = prevDislikes;
    if (prevMyRating === 'LIKE') optLikes = Math.max(0, optLikes - 1);
    if (prevMyRating === 'DISLIKE') optDislikes = Math.max(0, optDislikes - 1);
    if (nextOptimisticVote === 'LIKE') optLikes += 1;
    if (nextOptimisticVote === 'DISLIKE') optDislikes += 1;
    const optScore = optLikes - optDislikes;

    const applyRatingState = (
      likes: number,
      dislikes: number,
      score: number,
      myRating: 'LIKE' | 'DISLIKE' | null
    ) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId ? { ...m, likes, dislikes, score, myRating } : m
        )
      );
      setSelectedMessage((prev) =>
        prev && prev.id === messageId
          ? { ...prev, likes, dislikes, score, myRating }
          : prev
      );
    };

    // 1. Actualización optimista inmediata en UI
    applyRatingState(optLikes, optDislikes, optScore, nextOptimisticVote);

    try {
      const summary = isToggleOff
        ? await ratingService.removeRating(messageId)
        : await ratingService.rateMessage(messageId, vote);

      // 2. Reconciliación con el conteo autoritativo del backend
      applyRatingState(
        summary.likes,
        summary.dislikes,
        summary.score,
        summary.myRating
      );

      return { success: true };
    } catch (err: any) {
      // Revertir estado optimista si falló la petición
      applyRatingState(
        prevLikes,
        prevDislikes,
        prevLikes - prevDislikes,
        prevMyRating
      );
      return {
        success: false,
        error: err.message || 'No se pudo registrar tu calificación.',
      };
    }
  };

  // Filtrado de mensajes visibles:
  // En 'todos', los mensajes 'oculto' (BLOCKED) o 'pendiente' solo los ve su propio autor
  const activeMessages = messages.filter((m) => {
    if (m.status === 'eliminado') return false;
    if (statusFilter === 'todos') {
      if ((m.status === 'oculto' || m.status === 'pendiente') && m.authorId !== user?.id) {
        return false;
      }
      return true;
    }
    if ((statusFilter === 'oculto' || statusFilter === 'pendiente') && m.authorId !== user?.id) {
      return false;
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
