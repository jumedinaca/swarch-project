import { API_CONFIG } from '../../config/api.config';
import { apiClient } from '../api/apiClient';
import {
  User,
  LoginCredentials,
  RegisterCredentials,
  AuthResponseData,
  ApiResponse,
} from '../../types';
import { nintendoTheme } from '../../theme/nintendoTheme';

// Usuarios simulados para modo mock o fallback offline
const INITIAL_MOCK_USERS: User[] = [
  {
    id: 'user-demo-1',
    username: 'ExploradorGeo',
    email: 'explorador@geochat.org',
    color: nintendoTheme.colors.avatarColors[0],
    token: 'mock-jwt-token-explorador-12345',
  },
  {
    id: 'user-demo-2',
    username: 'ViajeroContextual',
    email: 'viajero@geochat.org',
    color: nintendoTheme.colors.avatarColors[1],
    token: 'mock-jwt-token-viajero-67890',
  },
];

class AuthService {
  private mockUsers: User[] = [...INITIAL_MOCK_USERS];

  /**
   * Inicia sesión a través del API Gateway (/api/auth/login)
   */
  public async login(
    credentials: LoginCredentials
  ): Promise<{ success: boolean; user?: User; token?: string; error?: string }> {
    // Si está forzado el modo mock, resolvemos localmente
    if (API_CONFIG.USE_MOCKS) {
      return this.mockLogin(credentials);
    }

    try {
      const response = await apiClient.post<AuthResponseData>(
        API_CONFIG.ROUTES.AUTH.LOGIN,
        credentials
      );

      if (response.success && response.data) {
        const { user, token } = response.data;
        apiClient.setAuthToken(token);
        return { success: true, user, token };
      }

      return {
        success: false,
        error: response.message || 'Credenciales inválidas',
      };
    } catch (error: any) {
      console.warn(
        `[AuthService] Error al conectar con el Gateway (${API_CONFIG.ROUTES.AUTH.LOGIN}):`,
        error.message
      );

      // Si está habilitado el fallback automático, no dejamos caer la app
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK) {
        console.info('[AuthService] Activando fallback con usuario simulado.');
        return this.mockLogin(credentials);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión con el servicio de autenticación.',
      };
    }
  }

  /**
   * Registra un nuevo usuario a través del API Gateway (/api/auth/register)
   */
  public async register(
    credentials: RegisterCredentials
  ): Promise<{ success: boolean; user?: User; token?: string; error?: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockRegister(credentials);
    }

    try {
      const response = await apiClient.post<AuthResponseData>(
        API_CONFIG.ROUTES.AUTH.REGISTER,
        credentials
      );

      if (response.success && response.data) {
        const { user, token } = response.data;
        apiClient.setAuthToken(token);
        return { success: true, user, token };
      }

      return {
        success: false,
        error: response.message || 'Error en el registro',
      };
    } catch (error: any) {
      console.warn(
        `[AuthService] Error al conectar con el Gateway (${API_CONFIG.ROUTES.AUTH.REGISTER}):`,
        error.message
      );

      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK) {
        console.info('[AuthService] Activando fallback con usuario simulado.');
        return this.mockRegister(credentials);
      }

      return {
        success: false,
        error: error.message || 'Error de conexión al registrar usuario.',
      };
    }
  }

  /**
   * Obtiene el perfil del usuario autenticado (/api/auth/profile)
   */
  public async getProfile(): Promise<ApiResponse<User>> {
    return apiClient.get<User>(API_CONFIG.ROUTES.AUTH.PROFILE);
  }

  /**
   * Cierra sesión y remueve el token de autorización
   */
  public async logout(): Promise<void> {
    try {
      if (!API_CONFIG.USE_MOCKS && apiClient.getAuthToken()) {
        await apiClient.post(API_CONFIG.ROUTES.AUTH.LOGOUT);
      }
    } catch {
      // Ignorar fallo en logout remoto
    } finally {
      apiClient.clearAuthToken();
    }
  }

  // ==========================================
  // Métodos de simulación (Mock / Fallback)
  // ==========================================

  private mockLogin(
    credentials: LoginCredentials
  ): { success: boolean; user?: User; token?: string; error?: string } {
    const trimmed = credentials.usernameOrEmail.trim().toLowerCase();
    const found = this.mockUsers.find(
      (u) =>
        u.username.toLowerCase() === trimmed || u.email.toLowerCase() === trimmed
    );

    if (found) {
      apiClient.setAuthToken(found.token || 'mock-token-xyz');
      return { success: true, user: found, token: found.token };
    }

    // Si no está registrado en la lista fija, creamos una sesión con ese nombre
    const randomColor =
      nintendoTheme.colors.avatarColors[
        this.mockUsers.length % nintendoTheme.colors.avatarColors.length
      ];

    const newUser: User = {
      id: `user-${Date.now()}`,
      username: credentials.usernameOrEmail.trim(),
      email: `${credentials.usernameOrEmail.trim().toLowerCase().replace(/\s+/g, '')}@geochat.org`,
      color: randomColor,
      token: `mock-token-${Date.now()}`,
    };

    this.mockUsers.push(newUser);
    apiClient.setAuthToken(newUser.token || null);
    return { success: true, user: newUser, token: newUser.token };
  }

  private mockRegister(
    credentials: RegisterCredentials
  ): { success: boolean; user?: User; token?: string; error?: string } {
    const randomColor =
      nintendoTheme.colors.avatarColors[
        this.mockUsers.length % nintendoTheme.colors.avatarColors.length
      ];

    const newUser: User = {
      id: `user-${Date.now()}`,
      username: credentials.username.trim(),
      email: credentials.email.trim(),
      color: randomColor,
      token: `mock-token-${Date.now()}`,
    };

    this.mockUsers.push(newUser);
    apiClient.setAuthToken(newUser.token || null);
    return { success: true, user: newUser, token: newUser.token };
  }
}

export const authService = new AuthService();
