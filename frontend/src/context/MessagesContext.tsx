import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import { GeoMessage, MessageStatus, LocationCoords } from '../types';
import { useAuth } from './AuthContext';
import { messagesService } from '../services/messages/messagesService';
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
        // Con el backend real una lista vacía es una respuesta válida
        setMessages(response.data);
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
