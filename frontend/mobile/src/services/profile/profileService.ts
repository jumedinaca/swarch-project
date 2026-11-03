import { API_CONFIG } from '../../config/api.config';
import { UserProfile } from '../../types';
import { INITIAL_MOCK_PROFILES } from '../../data/mockNetworkData';
import { apiClient, isNetworkError } from '../api/apiClient';

type Result<T> = { success: boolean; data?: T; error?: string };

function mockProfileMap(): Map<string, UserProfile> {
  return new Map(INITIAL_MOCK_PROFILES.map((profile) => [profile.userId, profile]));
}

class ProfileService {
  /** Resuelve perfiles públicos en lote para mostrar usuarios en lugar de ids. */
  public async getBatch(ids: string[]): Promise<Map<string, UserProfile>> {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    const result = new Map<string, UserProfile>();
    if (unique.length === 0) return result;

    if (API_CONFIG.USE_MOCKS) {
      const mock = mockProfileMap();
      unique.forEach((id) => {
        const profile = mock.get(id);
        if (profile) result.set(id, profile);
      });
      return result;
    }

    try {
      for (let index = 0; index < unique.length; index += 100) {
        const chunk = unique.slice(index, index + 100);
        const query = new URLSearchParams({ ids: chunk.join(',') });
        const response = await apiClient.get<UserProfile[]>(
          `${API_CONFIG.ROUTES.PROFILES.BATCH}?${query.toString()}`
        );
        if (response.success && Array.isArray(response.data)) {
          response.data.forEach((profile) => result.set(profile.userId, profile));
        }
      }
      return result;
    } catch (error) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        const mock = mockProfileMap();
        unique.forEach((id) => {
          const profile = mock.get(id);
          if (profile) result.set(id, profile);
        });
        return result;
      }
      console.warn('[ProfileService] No se pudieron resolver los perfiles:', error);
      return result;
    }
  }

  /** Busca exploradores por nombre visible o nombre de usuario. */
  public async search(query: string, limit = 10): Promise<Result<UserProfile[]>> {
    const clean = query.trim();
    if (!clean) {
      return { success: false, error: 'Escribe un nombre de usuario.' };
    }

    if (API_CONFIG.USE_MOCKS) {
      return { success: true, data: this.searchMock(clean, limit) };
    }

    try {
      const params = new URLSearchParams({ q: clean, limit: String(limit) });
      const response = await apiClient.get<UserProfile[]>(
        `${API_CONFIG.ROUTES.PROFILES.SEARCH}?${params.toString()}`
      );
      if (response.success && Array.isArray(response.data)) {
        return { success: true, data: response.data };
      }
      return {
        success: false,
        error: response.message || 'No se pudo buscar exploradores.',
      };
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return { success: true, data: this.searchMock(clean, limit) };
      }
      return {
        success: false,
        error: error.message || 'No se pudo buscar exploradores.',
      };
    }
  }

  private searchMock(query: string, limit: number): UserProfile[] {
    const needle = query.toLowerCase();
    return INITIAL_MOCK_PROFILES.filter(
      (profile) =>
        profile.username.toLowerCase().includes(needle) ||
        (profile.displayName ?? '').toLowerCase().includes(needle)
    ).slice(0, limit);
  }
}

export const profileService = new ProfileService();
