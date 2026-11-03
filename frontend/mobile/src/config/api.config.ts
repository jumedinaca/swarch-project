/**
 * Configuración centralizada para la conexión con el API Gateway
 *
 * El API Gateway actúa como el punto único de entrada que enruta las
 * peticiones hacia los microservicios de Autenticación y de Mensajes.
 */

// Permite leer variables de entorno con prefijo EXPO_PUBLIC_ en Expo SDK 57+
function resolveGatewayUrl(): string {
  // Si se abre en navegador web vía localhost/127.0.0.1, usar siempre localhost:8080
  // para evitar que una IP LAN de otra red Wi-Fi bloquee la versión web.
  if (
    typeof window !== 'undefined' &&
    window.location &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
  ) {
    return `http://${window.location.hostname}:8080`;
  }
  return process.env.EXPO_PUBLIC_API_GATEWAY_URL || 'http://localhost:8080';
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
   * URL base del API Gateway.
   * Ejemplo en desarrollo local: http://localhost:8080 o la IP de la máquina (ej: http://192.168.1.15:8080)
   * Ejemplo en producción: https://gateway.geopicto.org
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
