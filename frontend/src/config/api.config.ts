/**
 * Configuración centralizada para la conexión con el API Gateway
 *
 * El API Gateway actúa como el punto único de entrada que enruta las
 * peticiones hacia los microservicios de Autenticación y de Mensajes.
 */

// Permite leer variables de entorno con prefijo EXPO_PUBLIC_ en Expo SDK 57+
const GATEWAY_URL =
  process.env.EXPO_PUBLIC_API_GATEWAY_URL || 'http://localhost:8080';

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

  /**
   * Rutas estándar enrutadas por el API Gateway:
   * - /api/auth/*     -> Microservicio de Autenticación
   * - /api/messages/* -> Microservicio de Mensajes Geoespaciales
   */
  ROUTES: {
    AUTH: {
      LOGIN: '/api/auth/login',
      REGISTER: '/api/auth/register',
      PROFILE: '/api/auth/profile',
      LOGOUT: '/api/auth/logout',
    },
    MESSAGES: {
      BASE: '/api/messages',
      GET_ALL: '/api/messages',
      CREATE: '/api/messages',
      GET_BY_ID: (id: string) => `/api/messages/${id}`,
      DELETE: (id: string) => `/api/messages/${id}`,
      CHANGE_STATUS: (id: string) => `/api/messages/${id}/status`,
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
   */
  AUTO_FALLBACK_TO_MOCK: true,
};
