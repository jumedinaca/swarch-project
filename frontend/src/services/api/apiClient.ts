import { API_CONFIG } from '../../config/api.config';
import { ApiResponse } from '../../types';

export class ApiError extends Error {
  public statusCode: number;
  public details?: any;

  constructor(message: string, statusCode: number = 500, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

/**
 * true solo si el API Gateway no respondió (sin red, gateway apagado o timeout).
 * Un error HTTP del backend (401, 409, 422...) es una respuesta real y NO debe
 * ocultarse con datos simulados.
 */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && (error.statusCode === 0 || error.statusCode === 408);
}

/**
 * Cliente HTTP unificado para comunicarse con el API Gateway.
 * Administra el token JWT, cabeceras estándar, timeouts y manejo de errores.
 */
class ApiClient {
  private baseUrl: string = API_CONFIG.BASE_URL;
  private authToken: string | null = null;
  private refreshToken: string | null = null;
  private refreshInFlight: Promise<boolean> | null = null;
  private onSessionExpired: (() => void) | null = null;

  /**
   * Configura o actualiza la URL base del Gateway (útil si se cambia dinámicamente en tiempo de ejecución)
   */
  public setBaseUrl(url: string) {
    this.baseUrl = url.replace(/\/$/, ''); // Remover slash final
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  /**
   * Guarda el token JWT para ser enviado automáticamente en la cabecera 'Authorization: Bearer <token>'
   */
  public setAuthToken(token: string | null) {
    this.authToken = token;
  }

  public getAuthToken(): string | null {
    return this.authToken;
  }

  public clearAuthToken() {
    this.authToken = null;
    this.refreshToken = null;
  }

  /**
   * Refresh token emitido por el servicio de autenticación. El access token dura
   * 15 minutos; cuando una petición responde 401 se renueva una vez con este token.
   */
  public setRefreshToken(token: string | null) {
    this.refreshToken = token;
  }

  /** Se invoca cuando la sesión ya no se puede renovar (refresh token inválido o revocado). */
  public setOnSessionExpired(handler: (() => void) | null) {
    this.onSessionExpired = handler;
  }

  private async tryRefreshSession(): Promise<boolean> {
    if (!this.refreshToken) return false;

    // Si varias peticiones reciben 401 a la vez, se comparte una sola renovación
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.request<{ token: string; refreshToken: string }>(
        API_CONFIG.ROUTES.AUTH.REFRESH,
        { method: 'POST', body: JSON.stringify({ refreshToken: this.refreshToken }) },
        false
      )
        .then((response) => {
          if (response.success && response.data?.token) {
            this.authToken = response.data.token;
            this.refreshToken = response.data.refreshToken;
            return true;
          }
          return false;
        })
        .catch(() => false)
        .finally(() => {
          this.refreshInFlight = null;
        });
    }
    return this.refreshInFlight;
  }

  /**
   * Método base para ejecutar peticiones HTTP
   */
  public async request<T = any>(
    endpoint: string,
    options: RequestInit = {},
    allowRefresh: boolean = true
  ): Promise<ApiResponse<T>> {
    const fullUrl = `${this.baseUrl}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...((options.headers as Record<string, string>) || {}),
    };

    // Si tenemos token JWT, inyectamos la cabecera de autenticación
    if (this.authToken && !headers['Authorization']) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), API_CONFIG.TIMEOUT_MS);

    try {
      const response = await fetch(fullUrl, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Intentar procesar cuerpo como JSON
      let data: any = null;
      const contentType = response.headers.get('content-type');
      if (contentType && contentType.includes('application/json')) {
        try {
          data = await response.json();
        } catch {
          data = null;
        }
      } else {
        const text = await response.text();
        data = text ? { raw: text } : null;
      }

      // Access token vencido: se renueva con el refresh token y se reintenta una vez.
      // Las rutas de /api/auth no se reintentan (login/registro fallidos son 401 legítimos).
      if (
        response.status === 401 &&
        allowRefresh &&
        !endpoint.startsWith('/api/auth/') &&
        this.refreshToken
      ) {
        if (await this.tryRefreshSession()) {
          return this.request<T>(endpoint, options, false);
        }
        this.clearAuthToken();
        this.onSessionExpired?.();
      }

      if (!response.ok) {
        const errorMsg =
          data?.message ||
          data?.error ||
          data?.raw?.trim() ||
          `Error en API Gateway (${response.status}: ${response.statusText})`;
        throw new ApiError(errorMsg, response.status, data);
      }

      // Si la respuesta del backend ya tiene formato { success, data } lo adaptamos,
      // de lo contrario envolvemos el resultado
      if (data && typeof data === 'object' && 'data' in data && 'success' in data) {
        return {
          success: data.success,
          data: data.data,
          message: data.message,
          statusCode: response.status,
        };
      }

      return {
        success: true,
        data: data as T,
        statusCode: response.status,
      };
    } catch (error: any) {
      clearTimeout(timeoutId);

      if (error.name === 'AbortError') {
        throw new ApiError(
          `Tiempo de espera agotado al conectar con el API Gateway (${API_CONFIG.TIMEOUT_MS}ms)`,
          408
        );
      }

      if (error instanceof ApiError) {
        throw error;
      }

      // Error de red (offline, DNS, gateway no iniciado)
      throw new ApiError(
        `No fue posible conectar con el API Gateway en ${this.baseUrl}: ${error?.message || 'Error de red'}`,
        0,
        error
      );
    }
  }

  public async get<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', headers });
  }

  public async post<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  public async put<T = any>(endpoint: string, body?: any, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: body ? JSON.stringify(body) : undefined,
      headers,
    });
  }

  public async delete<T = any>(endpoint: string, headers?: Record<string, string>): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', headers });
  }
}

export const apiClient = new ApiClient();
