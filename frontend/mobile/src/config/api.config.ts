/**
 * Configuración centralizada para la conexión con el API Gateway
 *
 * El API Gateway actúa como el punto único de entrada que enruta las
 * peticiones hacia los microservicios de Autenticación y de Mensajes.
 */

const DEFAULT_GATEWAY_URL = 'https://localhost';

// Permite leer variables de entorno con prefijo EXPO_PUBLIC_ en Expo SDK 57+
function resolveGatewayUrl(): string {
  // En el navegador, cuando la app se sirve por HTTPS lo hace a traves del
  // reverse proxy perimetral, que publica la SPA (/) y el API Gateway (/api) en
  // el mismo origen. Usar ese origen evita Mixed Content, peticiones CORS entre
  // puertos y que una IP LAN incrustada en el build rompa la version web.
  if (
    typeof window !== 'undefined' &&
    window.location &&
    window.location.protocol === 'https:'
  ) {
    return window.location.origin;
  }
  // App nativa o servidor de desarrollo de Expo (http://localhost:8081): se usa
  // la URL publica del proxy configurada al compilar.
  return (process.env.EXPO_PUBLIC_API_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/$/, '');
}

const GATEWAY_URL = resolveGatewayUrl();

/**
 * Deriva la URL base de WebSocket a partir de EXPO_PUBLIC_WS_URL o de la URL HTTP del Gateway
 * convirtiendo http:// -> ws:// y https:// -> wss://.
 */
export function deriveWsBaseUrl(httpBaseUrl: string): string {
  const explicitWs = process.env.EXPO_PUBLIC_WS_URL;
  if (explicitWs && explicitWs.trim() !== '') {
    return explicitWs.trim().replace(/\/$/, '');
  }
  const normalized = httpBaseUrl.trim().replace(/\/$/, '');
  if (normalized.startsWith('https://')) {
    return `wss://${normalized.slice('https://'.length)}`;
  }
  if (normalized.startsWith('http://')) {
    return `ws://${normalized.slice('http://'.length)}`;
  }
  return `ws://${normalized}`;
}

// Determina si se usan mocks por defecto (útil para desarrollo offline o antes de desplegar el Gateway)
// Si EXPO_PUBLIC_USE_MOCK_DATA está explícitamente en 'false', se conectará a la red.
const IS_MOCK_ENABLED_BY_DEFAULT =
  process.env.EXPO_PUBLIC_USE_MOCK_DATA !== 'false';

export const API_CONFIG = {
  /**
   * URL publica del API Gateway, siempre detras del reverse proxy con TLS.
   * Ejemplo en local: https://localhost o la IP de la máquina (ej: https://192.168.1.15)
   * Ejemplo en producción: https://geopicto.org
   * WS_URL se deriva de ella (https:// -> wss://).
   */
  BASE_URL: GATEWAY_URL,
  WS_URL: deriveWsBaseUrl(GATEWAY_URL),

  /**
   * Rutas estándar enrutadas por el API Gateway:
   * - /api/auth/*     -> Microservicio de Autenticación
   * - /api/messages/* -> Microservicio de Mensajes Geoespaciales
   * - /api/network/*  -> Microservicio de red social (amigos)
   */
  ROUTES: {
    AUTH: {
      LOGIN: '/api/auth/login',
      REGISTER: '/api/auth/register',
      PROFILE: '/api/auth/profile',
      LOGOUT: '/api/auth/logout',
      REFRESH: '/api/auth/refresh',
    },
    MESSAGES: {
      BASE: '/api/messages',
      GET_ALL: '/api/messages',
      NEARBY: '/api/messages/nearby',
      CREATE: '/api/messages',
      GET_BY_ID: (id: string) => `/api/messages/${id}`,
      DELETE: (id: string) => `/api/messages/${id}`,
      CHANGE_STATUS: (id: string) => `/api/messages/${id}/status`,
    },
    NETWORK: {
      // El servicio de red social solo expone GraphQL
      GRAPHQL: '/api/network/graphql',
    },
    PROFILES: {
      ME: '/api/profiles/me',
      ME_AVATAR: '/api/profiles/me/avatar',
      BY_ID: (userId: string) => `/api/profiles/${userId}`,
      BATCH: '/api/profiles/batch',
      SEARCH: '/api/profiles/search',
    },
    RATINGS: {
      BY_MESSAGE: (messageId: string) => `/api/ratings/messages/${messageId}`,
      BATCH: '/api/ratings/messages/batch',
    },
    REPUTATION: {
      ME: '/api/reputation/me',
      BY_USER: (userId: string) => `/api/reputation/${userId}`,
      LEADERBOARD: '/api/reputation/leaderboard',
      HISTORY: (userId: string) => `/api/reputation/${userId}/history`,
      RECOMPUTE: (userId: string) => `/api/reputation/${userId}/recompute`,
    },
    SOCKET: {
      TICKETS: '/api/socket/tickets',
      WS: '/api/ws',
    },
  },

  /**
   * Tiempo de espera máximo para peticiones (en milisegundos)
   */
  TIMEOUT_MS: 8000,

  /**
   * Modo Mock:
   * Permite que la aplicación funcione de forma autónoma con datos simulados
   * si el API Gateway no está disponible o aún está en desarrollo.
   */
  USE_MOCKS: IS_MOCK_ENABLED_BY_DEFAULT,

  /**
   * Activar fallback automático: Si está en 'true', si una llamada a la red
   * falla por falta de conexión al API Gateway, se recurre automáticamente
   * a los datos simulados locales sin romper la interfaz de usuario.
   * Solo aplica a errores de red: las respuestas de error del backend
   * (credenciales inválidas, usuario repetido...) se muestran tal cual.
   */
  AUTO_FALLBACK_TO_MOCK: true,
};
