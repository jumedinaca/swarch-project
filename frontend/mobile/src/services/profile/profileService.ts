import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import { socketService } from '../realtime/socketService';
import { UpdateProfileDto, UserProfile } from '../../types';
import { nintendoTheme } from '../../theme/nintendoTheme';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Deriva un color estable a partir del `userId` cuando el perfil aún no existe.
 */
export function colorForUserId(userId: string): string {
  const palette = nintendoTheme.colors.avatarColors;
  if (!userId) return palette[0];
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

const nowIso = new Date().toISOString();

const INITIAL_MOCK_PROFILES: UserProfile[] = [
  {
    userId: 'user-demo-1',
    username: 'ExploradorGeo',
    displayName: 'Explorador Geo',
    about: 'Cazando PictoNotas en 3D por el campus UNAL y toda Bogotá.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[0],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-2',
    username: 'ViajeroContextual',
    displayName: 'Viajero Contextual',
    about: 'Amante del café de origen, ciclorrutas y rincones culturales.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[1],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-3',
    username: 'ComunidadLocal',
    displayName: 'Comunidad Local',
    about: 'Agenda cultural, conciertos filarmónicos y ferias abiertas.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[2],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-4',
    username: 'EstudianteUN',
    displayName: 'Estudiante UN',
    about: 'Dibujo urbano y tardes de estudio en el campus.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[3],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-5',
    username: 'PictoRolo',
    displayName: 'PictoRolo',
    about: 'Reseñas de espacios de coworking, bibliotecas y cafés.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[4],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-6',
    username: 'BiciRutaBta',
    displayName: 'BiciRuta Bta',
    about: 'Reportes en tiempo real de ciclorrutas y parques de Bogotá.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[5],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-7',
    username: 'CafeteroAndino',
    displayName: 'Cafetero Andino',
    about: 'Catador de cafés especiales por Teusaquillo y Chapinero.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[1],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
  {
    userId: 'user-demo-8',
    username: 'CulturaBogota',
    displayName: 'Cultura Bogotá',
    about: 'Teatro independiente, museos y jardines botánicos.',
    avatarUrl: null,
    color: nintendoTheme.colors.avatarColors[2],
    createdAt: nowIso,
    updatedAt: nowIso,
  },
];

class ProfileService {
  private mockProfiles = new Map<string, UserProfile>(
    INITIAL_MOCK_PROFILES.map((p) => [p.userId, p])
  );

  private ensureMockProfile(userId: string, usernameFallback?: string): UserProfile {
    const existing = this.mockProfiles.get(userId);
    if (existing) return existing;

    const uname = usernameFallback || `Explorador_${userId.slice(0, 5)}`;
    const created: UserProfile = {
      userId,
      username: uname,
      displayName: uname,
      about: 'Explorador de GeoPicto.',
      avatarUrl: null,
      color: colorForUserId(userId),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.mockProfiles.set(userId, created);
    return created;
  }

  /**
   * Obtiene el perfil del usuario autenticado (`GET /api/profiles/me`).
   * Si aún no existe en el backend, el servicio lo crea de forma perezosa.
   */
  public async getMe(fallbackUser?: { id: string; username: string }): Promise<UserProfile> {
    if (API_CONFIG.USE_MOCKS) {
      return this.ensureMockProfile(
        fallbackUser?.id || 'user-demo-1',
        fallbackUser?.username || 'ExploradorGeo'
      );
    }

    try {
      const profile = await apiClient.requestRaw<UserProfile>(API_CONFIG.ROUTES.PROFILES.ME, {
        method: 'GET',
      });
      this.mockProfiles.set(profile.userId, profile);
      return profile;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.ensureMockProfile(
          fallbackUser?.id || 'user-demo-1',
          fallbackUser?.username || 'ExploradorGeo'
        );
      }
      throw error;
    }
  }

  /**
   * Actualiza parcialmente el perfil propio (`PATCH /api/profiles/me`).
   */
  public async updateMe(
    dto: UpdateProfileDto,
    fallbackUser?: { id: string; username: string }
  ): Promise<UserProfile> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockUpdateMe(dto, fallbackUser);
    }

    try {
      const updated = await apiClient.requestRaw<UserProfile>(API_CONFIG.ROUTES.PROFILES.ME, {
        method: 'PATCH',
        body: JSON.stringify(dto),
      });
      this.mockProfiles.set(updated.userId, updated);
      return updated;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockUpdateMe(dto, fallbackUser);
      }
      throw error;
    }
  }

  /**
   * Sube una nueva imagen de avatar (`POST /api/profiles/me/avatar` con `multipart/form-data`).
   */
  public async uploadAvatar(
    file: Blob | File,
    fallbackUser?: { id: string; username: string }
  ): Promise<{ avatarUrl: string }> {
    if (API_CONFIG.USE_MOCKS) {
      return this.mockUploadAvatar(file, fallbackUser);
    }

    try {
      const form = new FormData();
      const fileName = (file as File).name || 'avatar.png';
      form.append('file', file, fileName);

      const result = await apiClient.requestRaw<{ avatarUrl: string }>(
        API_CONFIG.ROUTES.PROFILES.ME_AVATAR,
        {
          method: 'POST',
          body: form,
        }
      );

      if (fallbackUser?.id) {
        const existing = this.mockProfiles.get(fallbackUser.id);
        if (existing) {
          this.mockProfiles.set(fallbackUser.id, {
            ...existing,
            avatarUrl: result.avatarUrl,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      return result;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockUploadAvatar(file, fallbackUser);
      }
      throw error;
    }
  }

  /**
   * Elimina el avatar del usuario autenticado (`DELETE /api/profiles/me/avatar`).
   */
  public async deleteAvatar(fallbackUser?: { id: string; username: string }): Promise<void> {
    if (API_CONFIG.USE_MOCKS) {
      this.mockDeleteAvatar(fallbackUser);
      return;
    }

    try {
      await apiClient.requestRaw<void>(API_CONFIG.ROUTES.PROFILES.ME_AVATAR, {
        method: 'DELETE',
      });
      if (fallbackUser?.id) {
        const existing = this.mockProfiles.get(fallbackUser.id);
        if (existing) {
          this.mockProfiles.set(fallbackUser.id, {
            ...existing,
            avatarUrl: null,
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        this.mockDeleteAvatar(fallbackUser);
        return;
      }
      throw error;
    }
  }

  /**
   * Consulta el perfil público de un usuario por su ID (`GET /api/profiles/{userId}`).
   */
  public async getById(userId: string): Promise<UserProfile | null> {
    const cleanId = userId.trim();
    if (!cleanId) return null;

    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(cleanId)) {
      return this.ensureMockProfile(cleanId);
    }

    try {
      const profile = await apiClient.requestRaw<UserProfile>(
        API_CONFIG.ROUTES.PROFILES.BY_ID(cleanId),
        { method: 'GET' }
      );
      if (profile) {
        this.mockProfiles.set(profile.userId, profile);
      }
      return profile;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.ensureMockProfile(cleanId);
      }
      if (error?.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Resuelve hasta 100 perfiles en una sola petición (`GET /api/profiles/batch?ids=uuid,uuid`).
   */
  public async getBatch(userIds: string[]): Promise<UserProfile[]> {
    const uniqueIds = Array.from(
      new Set(userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))
    ).slice(0, 100);

    if (uniqueIds.length === 0) return [];

    if (API_CONFIG.USE_MOCKS) {
      return uniqueIds.map((id) => this.ensureMockProfile(id));
    }

    const validUuids = uniqueIds.filter((id) => UUID_REGEX.test(id));
    const nonUuidResults = uniqueIds
      .filter((id) => !UUID_REGEX.test(id))
      .map((id) => this.ensureMockProfile(id));

    if (validUuids.length === 0) {
      return nonUuidResults;
    }

    try {
      const query = new URLSearchParams({ ids: validUuids.join(',') });
      const profiles = await apiClient.requestRaw<UserProfile[]>(
        `${API_CONFIG.ROUTES.PROFILES.BATCH}?${query.toString()}`,
        { method: 'GET' }
      );

      const list = Array.isArray(profiles) ? profiles : [];
      list.forEach((p) => {
        if (p && p.userId) {
          this.mockProfiles.set(p.userId, p);
        }
      });

      return [...list, ...nonUuidResults];
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return uniqueIds.map((id) => this.ensureMockProfile(id));
      }
      return nonUuidResults;
    }
  }

  /**
   * Resuelve perfiles en lote y retorna un mapa indexado por userId.
   */
  public async getBatchMap(userIds: string[]): Promise<Map<string, UserProfile>> {
    const list = await this.getBatch(userIds);
    return new Map(list.map((p) => [p.userId, p]));
  }

  /**
   * Busca perfiles por nombre visible o username (`GET /api/profiles/search?q=&limit=`).
   */
  public async search(query: string, limit: number = 20): Promise<UserProfile[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    if (API_CONFIG.USE_MOCKS) {
      return this.mockSearch(trimmed, limit);
    }

    try {
      const params = new URLSearchParams({
        q: trimmed,
        limit: String(Math.min(50, Math.max(1, limit))),
      });
      const results = await apiClient.requestRaw<UserProfile[]>(
        `${API_CONFIG.ROUTES.PROFILES.SEARCH}?${params.toString()}`,
        { method: 'GET' }
      );
      return Array.isArray(results) ? results : [];
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockSearch(trimmed, limit);
      }
      throw error;
    }
  }

  // ==========================================
  // Métodos de simulación (Mock / Fallback)
  // ==========================================

  private mockUpdateMe(
    dto: UpdateProfileDto,
    fallbackUser?: { id: string; username: string }
  ): UserProfile {
    const current = this.ensureMockProfile(
      fallbackUser?.id || 'user-demo-1',
      fallbackUser?.username || 'ExploradorGeo'
    );

    const changedFields: string[] = [];
    let nextDisplayName = current.displayName;
    let nextAbout = current.about;
    let nextColor = current.color;

    if ('displayName' in dto) {
      const cleaned = dto.displayName?.trim() || null;
      nextDisplayName = cleaned;
      changedFields.push('displayName');
    }
    if ('about' in dto) {
      const cleaned = dto.about?.trim() || null;
      nextAbout = cleaned;
      changedFields.push('about');
    }
    if ('color' in dto) {
      nextColor = dto.color ? dto.color.toUpperCase() : colorForUserId(current.userId);
      changedFields.push('color');
    }

    const updated: UserProfile = {
      ...current,
      displayName: nextDisplayName,
      about: nextAbout,
      color: nextColor,
      updatedAt: new Date().toISOString(),
    };

    this.mockProfiles.set(updated.userId, updated);

    if (changedFields.length > 0) {
      socketService.emitMockEvent('profile.updated.v1', {
        userId: updated.userId,
        changedFields,
        displayName: updated.displayName || updated.username,
        avatarUrl: updated.avatarUrl,
        color: updated.color,
        updatedAt: updated.updatedAt,
      });
    }

    return updated;
  }

  private async mockUploadAvatar(
    file: Blob | File,
    fallbackUser?: { id: string; username: string }
  ): Promise<{ avatarUrl: string }> {
    const current = this.ensureMockProfile(
      fallbackUser?.id || 'user-demo-1',
      fallbackUser?.username || 'ExploradorGeo'
    );

    let dataUrl = '';
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      dataUrl = URL.createObjectURL(file);
    }

    const updated: UserProfile = {
      ...current,
      avatarUrl: dataUrl || null,
      updatedAt: new Date().toISOString(),
    };
    this.mockProfiles.set(updated.userId, updated);

    socketService.emitMockEvent('profile.updated.v1', {
      userId: updated.userId,
      changedFields: ['avatarUrl'],
      displayName: updated.displayName || updated.username,
      avatarUrl: updated.avatarUrl,
      color: updated.color,
      updatedAt: updated.updatedAt,
    });

    return { avatarUrl: updated.avatarUrl || '' };
  }

  private mockDeleteAvatar(fallbackUser?: { id: string; username: string }): void {
    const current = this.ensureMockProfile(
      fallbackUser?.id || 'user-demo-1',
      fallbackUser?.username || 'ExploradorGeo'
    );
    const updated: UserProfile = {
      ...current,
      avatarUrl: null,
      updatedAt: new Date().toISOString(),
    };
    this.mockProfiles.set(updated.userId, updated);

    socketService.emitMockEvent('profile.updated.v1', {
      userId: updated.userId,
      changedFields: ['avatarUrl'],
      displayName: updated.displayName || updated.username,
      avatarUrl: null,
      color: updated.color,
      updatedAt: updated.updatedAt,
    });
  }

  private mockSearch(query: string, limit: number): UserProfile[] {
    const q = query.toLowerCase();
    const matches: UserProfile[] = [];
    this.mockProfiles.forEach((p) => {
      if (
        p.username.toLowerCase().includes(q) ||
        (p.displayName && p.displayName.toLowerCase().includes(q)) ||
        p.userId.toLowerCase().includes(q)
      ) {
        matches.push(p);
      }
    });
    return matches.slice(0, limit);
  }
}

export const profileService = new ProfileService();
