import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  ReactNode,
} from 'react';
import {
  LocationCoords,
  RealtimeConnectionState,
  RealtimeEventFrame,
  RealtimeEventName,
  RealtimeToast,
} from '../types';
import { useAuth } from './AuthContext';
import { socketService } from '../services/realtime/socketService';
import { API_CONFIG } from '../config/api.config';
import { calculateDistanceMeters } from '../utils/geoUtils';

const HEARTBEAT_INTERVAL_MS = 30_000;
const MIN_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const MAX_DEDUPE_IDS = 200;
const TOAST_DURATION_MS = 5_500;

type EventHandler = (frame: RealtimeEventFrame) => void;
type ReconnectHandler = () => void;

interface RealtimeContextType {
  connectionState: RealtimeConnectionState;
  connectionId: string | null;
  toasts: RealtimeToast[];
  dismissToast: (id: string) => void;
  pushToast: (
    title: string,
    message: string,
    variant?: RealtimeToast['variant']
  ) => void;
  /**
   * Suscribe un componente a un tópico del servidor (`user:<id>`, `message:<id>`, `global`).
   * Retorna una función de limpieza que reduce la cuenta de referencias y envía `unsubscribe`
   * cuando ya ningún componente lo necesita.
   */
  subscribeTopic: (topic: string) => () => void;
  /**
   * Registra un listener para un tipo de evento específico (o `'*'` para todos).
   */
  onEvent: (eventName: RealtimeEventName | '*', handler: EventHandler) => () => void;
  /**
   * Registra un callback que se ejecuta cuando el WebSocket se reconecta tras una caída,
   * permitiendo reconciliar el estado vía HTTP.
   */
  onReconnected: (handler: ReconnectHandler) => () => void;
  /**
   * Actualiza la ubicación y radio de alcance (radar) del usuario tanto localmente
   * como en el servidor WebSocket (`set_location`) para filtrar eventos fuera de rango.
   */
  updateRadarLocation: (coords: LocationCoords, radiusMeters: number) => void;
  /**
   * Permite simular un evento en tiempo real localmente (útil en modo Mock o pruebas).
   */
  simulateRealtimeEvent: <T = any>(event: RealtimeEventName, payload: T) => void;
}

const RealtimeContext = createContext<RealtimeContextType | undefined>(undefined);

export const RealtimeProvider = ({ children }: { children: ReactNode }) => {
  const { user, isAuthenticated } = useAuth();

  const [connectionState, setConnectionState] =
    useState<RealtimeConnectionState>('disconnected');
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<RealtimeToast[]>([]);

  const wsRef = useRef<WebSocket | null>(null);
  const requestIdCounterRef = useRef<number>(1);
  const reconnectAttemptRef = useRef<number>(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const hadConnectedOnceRef = useRef<boolean>(false);
  const unmountedRef = useRef<boolean>(false);

  // Conteo de referencias por tópico para saber cuáles siguen activos al reconectar
  const topicRefCountsRef = useRef<Map<string, number>>(new Map());
  // Listeners de eventos registrados por los contextos/pantallas
  const eventListenersRef = useRef<Map<string, Set<EventHandler>>>(new Map());
  // Callbacks de reconciliación HTTP al reconectar
  const reconnectListenersRef = useRef<Set<ReconnectHandler>>(new Set());
  // Ring buffer de eventIds procesados para deduplicación
  const processedEventIdsRef = useRef<string[]>([]);
  // Configuración actual del radar geoespacial del usuario (coordenadas + radio en metros)
  const radarRef = useRef<{ latitude: number; longitude: number; radiusMeters: number } | null>(
    null
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback(
    (
      title: string,
      message: string,
      variant: RealtimeToast['variant'] = 'info'
    ) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast: RealtimeToast = {
        id,
        title,
        message,
        variant,
        createdAt: Date.now(),
      };
      setToasts((prev) => [toast, ...prev].slice(0, 4));

      setTimeout(() => {
        dismissToast(id);
      }, TOAST_DURATION_MS);
    },
    [dismissToast]
  );

  const isDuplicateEvent = useCallback((eventId: string | undefined): boolean => {
    if (!eventId) return false;
    const list = processedEventIdsRef.current;
    if (list.includes(eventId)) {
      return true;
    }
    list.push(eventId);
    if (list.length > MAX_DEDUPE_IDS) {
      list.shift();
    }
    return false;
  }, []);

  const sendJsonFrame = useCallback((payload: Record<string, any>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(payload));
      } catch (err) {
        console.warn('[RealtimeContext] No se pudo enviar frame WS:', err);
      }
    }
  }, []);

  const sendSubscribeFrame = useCallback(
    (topics: string[]) => {
      if (topics.length === 0) return;
      const reqId = String(requestIdCounterRef.current++);
      sendJsonFrame({
        type: 'subscribe',
        requestId: reqId,
        topics,
      });
    },
    [sendJsonFrame]
  );

  const sendUnsubscribeFrame = useCallback(
    (topics: string[]) => {
      if (topics.length === 0) return;
      const reqId = String(requestIdCounterRef.current++);
      sendJsonFrame({
        type: 'unsubscribe',
        requestId: reqId,
        topics,
      });
    },
    [sendJsonFrame]
  );

  const handleEventToast = useCallback(
    (frame: RealtimeEventFrame) => {
      const { event, payload } = frame;
      if (!payload || typeof payload !== 'object') return;

      switch (event) {
        case 'notification.requested.v1': {
          const title = payload.title || 'Nueva notificación';
          const body = payload.body || payload.message || 'Tienes una alerta nueva en GeoPicto.';
          pushToast(title, body, 'info');
          break;
        }
        case 'activity.created.v1': {
          if (payload.summary && String(payload.summary).trim() !== '') {
            pushToast('Red Social', String(payload.summary), 'info');
          }
          break;
        }
        case 'reputation.changed.v1': {
          const delta = Number(payload.delta ?? 0);
          const level = payload.level || 'Novato';
          const score = payload.score ?? 0;
          if (payload.levelChanged) {
            pushToast(
              `¡Nivel ${level}!`,
              `Tu reputación ahora es ${score} pts (${delta >= 0 ? `+${delta}` : delta}).`,
              delta >= 0 ? 'success' : 'warning'
            );
          } else if (delta !== 0) {
            pushToast(
              'Reputación actualizada',
              `${delta > 0 ? `+${delta}` : delta} pts · Total: ${score} (${level})`,
              delta > 0 ? 'success' : 'warning'
            );
          }
          break;
        }
        case 'moderation.completed.v1': {
          if (user && payload.authorId && payload.authorId !== user.id && payload.authorId !== 'global') {
            break;
          }
          const decision = String(payload.decision || '').toUpperCase();
          if (decision === 'BLOCK') {
            pushToast(
              'Mensaje bloqueado',
              'Tu mensaje fue ocultado por infringir las normas de la comunidad.',
              'error'
            );
          } else if (decision === 'WARN') {
            pushToast(
              'Publicado con advertencia',
              'Tu mensaje está visible pero recibió una marca de moderación.',
              'warning'
            );
          } else if (decision === 'ALLOW') {
            pushToast(
              'Mensaje publicado',
              'Tu PictoNota pasó la revisión y ya es visible en el mapa.',
              'success'
            );
          }
          break;
        }
        case 'message.published.v1': {
          if (user && payload.authorId && payload.authorId === user.id) {
            break;
          }
          const radar = radarRef.current;
          let title = 'Nueva PictoNota en tu rango';
          if (
            radar &&
            typeof payload.latitude === 'number' &&
            typeof payload.longitude === 'number'
          ) {
            const dist = calculateDistanceMeters(
              radar.latitude,
              radar.longitude,
              payload.latitude,
              payload.longitude
            );
            if (dist > radar.radiusMeters) {
              break;
            }
            title = `Nueva PictoNota (a ${dist}m)`;
          }
          const preview = String(payload.contentPreview || 'Nueva nota cerca de tu ubicación.').slice(0, 90);
          pushToast(title, preview, 'info');
          break;
        }
        case 'rating.changed.v1': {
          if (
            user &&
            payload.messageAuthorId === user.id &&
            payload.raterId !== user.id
          ) {
            const val = Number(payload.value ?? 0);
            if (val === 1) {
              pushToast(
                '¡Nuevo Like en tu nota!',
                `👍 ${payload.likes ?? 1} · 👎 ${payload.dislikes ?? 0}`,
                'success'
              );
            } else if (val === -1) {
              pushToast(
                'Nuevo voto en tu nota',
                `👍 ${payload.likes ?? 0} · 👎 ${payload.dislikes ?? 1}`,
                'warning'
              );
            }
          }
          break;
        }
        case 'profile.updated.v1': {
          if (user && payload.userId === user.id) {
            pushToast(
              'Perfil sincronizado',
              'Los cambios de tu perfil ya son visibles en el mapa.',
              'success'
            );
          }
          break;
        }
        default:
          break;
      }
    },
    [pushToast, user]
  );

  const dispatchIncomingEvent = useCallback(
    (frame: RealtimeEventFrame) => {
      if (isDuplicateEvent(frame.eventId)) {
        return;
      }

      // Filtrado geoespacial: si el evento es una nueva nota de otro usuario y está
      // fuera del rango de radar configurado, la descartamos sin notificar ni agregarla.
      if (
        frame.event === 'message.published.v1' &&
        frame.payload &&
        (!user || frame.payload.authorId !== user.id) &&
        radarRef.current &&
        typeof frame.payload.latitude === 'number' &&
        typeof frame.payload.longitude === 'number'
      ) {
        const dist = calculateDistanceMeters(
          radarRef.current.latitude,
          radarRef.current.longitude,
          frame.payload.latitude,
          frame.payload.longitude
        );
        if (dist > radarRef.current.radiusMeters) {
          return;
        }
      }

      handleEventToast(frame);

      const specificListeners = eventListenersRef.current.get(frame.event);
      if (specificListeners) {
        specificListeners.forEach((fn) => {
          try {
            fn(frame);
          } catch (err) {
            console.warn('[RealtimeContext] Error en handler de evento:', err);
          }
        });
      }

      const wildcardListeners = eventListenersRef.current.get('*');
      if (wildcardListeners) {
        wildcardListeners.forEach((fn) => {
          try {
            fn(frame);
          } catch (err) {
            console.warn('[RealtimeContext] Error en handler wildcard:', err);
          }
        });
      }
      },
    [handleEventToast, isDuplicateEvent, user]
  );

  const updateRadarLocation = useCallback(
    (coords: LocationCoords, radiusMeters: number) => {
      if (
        !coords ||
        typeof coords.latitude !== 'number' ||
        typeof coords.longitude !== 'number'
      ) {
        return;
      }
      radarRef.current = {
        latitude: coords.latitude,
        longitude: coords.longitude,
        radiusMeters,
      };
      sendJsonFrame({
        type: 'set_location',
        latitude: coords.latitude,
        longitude: coords.longitude,
        radiusMeters,
      });
    },
    [sendJsonFrame]
  );

  const clearTimers = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  }, []);

  const closeCurrentSocket = useCallback(() => {
    clearTimers();
    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      try {
        ws.close(1000, 'Client disconnect');
      } catch {
        // Ignorar errores al cerrar socket ya cerrado
      }
    }
  }, [clearTimers]);

  // Suscripción a eventos simulados cuando se usa el modo Mock
  useEffect(() => {
    const unsubscribeMock = socketService.onMockEvent((frame) => {
      dispatchIncomingEvent(frame);
    });
    return unsubscribeMock;
  }, [dispatchIncomingEvent]);

  // Efecto principal de conexión WebSocket (solo se ejecuta en cliente dentro de useEffect, seguro para SSR)
  useEffect(() => {
    unmountedRef.current = false;

    if (!isAuthenticated || !user?.id) {
      closeCurrentSocket();
      hadConnectedOnceRef.current = false;
      reconnectAttemptRef.current = 0;
      setConnectionId(null);
      setConnectionState('disconnected');
      return;
    }

    // Asegurar que los tópicos base (`user:<id>` y `global`) estén registrados
    const userTopic = `user:${user.id}`;
    const counts = topicRefCountsRef.current;
    counts.set(userTopic, (counts.get(userTopic) || 0) + 1);
    counts.set('global', (counts.get('global') || 0) + 1);

    if (API_CONFIG.USE_MOCKS) {
      setConnectionState('connected');
      setConnectionId(`mock-${user.id.slice(0, 6)}`);
      return () => {
        counts.delete(userTopic);
      };
    }

    if (typeof WebSocket === 'undefined') {
      return;
    }

    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled || unmountedRef.current) return;
      clearTimers();

      const attempt = reconnectAttemptRef.current;
      const expDelay = Math.min(MAX_BACKOFF_MS, MIN_BACKOFF_MS * Math.pow(2, attempt));
      const jitter = Math.floor(Math.random() * 1_000);
      const delayMs = expDelay + jitter;

      reconnectAttemptRef.current = attempt + 1;
      setConnectionState('reconnecting');

      reconnectTimerRef.current = setTimeout(() => {
        if (!cancelled && !unmountedRef.current) {
          connectWebSocket();
        }
      }, delayMs);
    };

    const connectWebSocket = async () => {
      if (cancelled || unmountedRef.current) return;

      closeCurrentSocket();
      setConnectionState(reconnectAttemptRef.current > 0 ? 'reconnecting' : 'connecting');

      try {
        const { ticket } = await socketService.requestTicket();
        if (cancelled || unmountedRef.current) return;

        const wsUrl = socketService.buildWebSocketUrl(ticket);
        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onmessage = (event) => {
          if (cancelled || unmountedRef.current) return;
          try {
            const data = JSON.parse(String(event.data));
            if (!data || typeof data.type !== 'string') return;

            if (data.type === 'ready') {
              const isReconnection = hadConnectedOnceRef.current;
              hadConnectedOnceRef.current = true;
              reconnectAttemptRef.current = 0;
              setConnectionId(data.connectionId || null);
              setConnectionState('connected');

              // Suscribirse a todos los tópicos activos actuales
              const activeTopics = Array.from(topicRefCountsRef.current.entries())
                .filter(([, count]) => count > 0)
                .map(([topic]) => topic);

              sendSubscribeFrame(activeTopics);

              // Enviar ubicación y radio de radar actuales al servidor para filtrado geoespacial
              if (radarRef.current) {
                sendJsonFrame({
                  type: 'set_location',
                  latitude: radarRef.current.latitude,
                  longitude: radarRef.current.longitude,
                  radiusMeters: radarRef.current.radiusMeters,
                });
              }

              // Iniciar heartbeat cada 30 s
              if (heartbeatTimerRef.current) {
                clearInterval(heartbeatTimerRef.current);
              }
              heartbeatTimerRef.current = setInterval(() => {
                sendJsonFrame({ type: 'ping', ts: Date.now() });
              }, HEARTBEAT_INTERVAL_MS);

              // Si es una reconexión, reconciliar el estado por HTTP
              if (isReconnection) {
                reconnectListenersRef.current.forEach((cb) => {
                  try {
                    cb();
                  } catch (err) {
                    console.warn('[RealtimeContext] Error en callback onReconnected:', err);
                  }
                });
              }
            } else if (data.type === 'event') {
              dispatchIncomingEvent(data as RealtimeEventFrame);
            } else if (data.type === 'error') {
              console.warn(
                `[RealtimeContext] Error reportado por el servidor (${data.code}): ${data.message}`
              );
            }
          } catch {
            // Ignorar frames que no sean JSON válido
          }
        };

        ws.onerror = () => {
          // El evento onclose se dispara inmediatamente después y programa el backoff
        };

        ws.onclose = () => {
          if (cancelled || unmountedRef.current) return;
          scheduleReconnect();
        };
      } catch (err: any) {
        if (cancelled || unmountedRef.current) return;
        console.warn('[RealtimeContext] No se pudo establecer conexión WS:', err?.message);
        scheduleReconnect();
      }
    };

    connectWebSocket();

    return () => {
      cancelled = true;
      unmountedRef.current = true;
      counts.delete(userTopic);
      closeCurrentSocket();
    };
  }, [
    isAuthenticated,
    user?.id,
    closeCurrentSocket,
    clearTimers,
    sendSubscribeFrame,
    sendJsonFrame,
    dispatchIncomingEvent,
  ]);

  const subscribeTopic = useCallback(
    (topic: string): (() => void) => {
      const normalized = topic.trim();
      if (!normalized) return () => {};

      const counts = topicRefCountsRef.current;
      const prevCount = counts.get(normalized) || 0;
      counts.set(normalized, prevCount + 1);

      if (prevCount === 0) {
        sendSubscribeFrame([normalized]);
      }

      return () => {
        const current = counts.get(normalized) || 0;
        if (current <= 1) {
          counts.delete(normalized);
          sendUnsubscribeFrame([normalized]);
        } else {
          counts.set(normalized, current - 1);
        }
      };
    },
    [sendSubscribeFrame, sendUnsubscribeFrame]
  );

  const onEvent = useCallback(
    (eventName: RealtimeEventName | '*', handler: EventHandler): (() => void) => {
      const map = eventListenersRef.current;
      let set = map.get(eventName);
      if (!set) {
        set = new Set();
        map.set(eventName, set);
      }
      set.add(handler);

      return () => {
        const existing = map.get(eventName);
        if (existing) {
          existing.delete(handler);
        }
      };
    },
    []
  );

  const onReconnected = useCallback((handler: ReconnectHandler): (() => void) => {
    reconnectListenersRef.current.add(handler);
    return () => {
      reconnectListenersRef.current.delete(handler);
    };
  }, []);

  const simulateRealtimeEvent = useCallback(
    <T = any>(event: RealtimeEventName, payload: T) => {
      socketService.emitMockEvent(event, payload);
    },
    []
  );

  return (
    <RealtimeContext.Provider
      value={{
        connectionState,
        connectionId,
        toasts,
        dismissToast,
        pushToast,
        subscribeTopic,
        onEvent,
        onReconnected,
        updateRadarLocation,
        simulateRealtimeEvent,
      }}
    >
      {children}
    </RealtimeContext.Provider>
  );
};

export const useRealtime = (): RealtimeContextType => {
  const context = useContext(RealtimeContext);
  if (!context) {
    throw new Error('useRealtime debe ser utilizado dentro de un RealtimeProvider');
  }
  return context;
};
