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
 * Cliente HTTP unificado para comunicarse con el API Gateway.
 * Administra el token JWT, cabeceras estándar, timeouts y manejo de errores.
 */
class ApiClient {
  private baseUrl: string = API_CONFIG.BASE_URL;
  private authToken: string | null = null;

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
  }

  /**
   * Método base para ejecutar peticiones HTTP
   */
  public async request<T = any>(
    endpoint: string,
    options: RequestInit = {}
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

      if (!response.ok) {
        const errorMsg =
          data?.message ||
          data?.error ||
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
