import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { UpdateProfileDto, UserProfile, UserReputation } from '../types';
import { useAuth } from './AuthContext';
import { useRealtime } from './RealtimeContext';
import {
  profileService,
  colorForUserId,
} from '../services/profile/profileService';
import { reputationService } from '../services/reputation/reputationService';

export interface ProfileDisplayInfo {
  displayName: string;
  username: string;
  color: string;
  avatarUrl: string | null;
  about: string | null;
}

interface ProfileContextType {
  myProfile: UserProfile | null;
  myReputation: UserReputation | null;
  profilesById: Record<string, UserProfile>;
  isLoadingProfile: boolean;
  isLoadingReputation: boolean;
  profileError: string | null;
  refreshMyProfile: () => Promise<void>;
  refreshMyReputation: () => Promise<void>;
  updateMyProfile: (
    dto: UpdateProfileDto
  ) => Promise<{ success: boolean; profile?: UserProfile; error?: string }>;
  uploadMyAvatar: (
    file: Blob | File
  ) => Promise<{ success: boolean; avatarUrl?: string; error?: string }>;
  deleteMyAvatar: () => Promise<{ success: boolean; error?: string }>;
  recomputeMyReputation: () => Promise<{ success: boolean; error?: string }>;
  resolveProfiles: (userIds: string[]) => Promise<Record<string, UserProfile>>;
  getProfileDisplay: (userId: string, fallbackName?: string) => ProfileDisplayInfo;
}

const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export const ProfileProvider = ({ children }: { children: ReactNode }) => {
  const { user, isAuthenticated } = useAuth();
  const { onEvent, onReconnected } = useRealtime();

  const [myProfile, setMyProfile] = useState<UserProfile | null>(null);
  const [myReputation, setMyReputation] = useState<UserReputation | null>(null);
  const [profilesById, setProfilesById] = useState<Record<string, UserProfile>>({});
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(false);
  const [isLoadingReputation, setIsLoadingReputation] = useState<boolean>(false);
  const [profileError, setProfileError] = useState<string | null>(null);

  const profilesCacheRef = useRef<Record<string, UserProfile>>({});
  profilesCacheRef.current = profilesById;

  const refreshMyProfile = useCallback(async () => {
    if (!user?.id) {
      setMyProfile(null);
      return;
    }

    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      const profile = await profileService.getMe({
        id: user.id,
        username: user.username,
      });
      setMyProfile(profile);
      setProfilesById((prev) => ({
        ...prev,
        [profile.userId]: profile,
      }));
    } catch (err: any) {
      console.warn('[ProfileContext] Error al cargar perfil propio:', err.message);
      setProfileError(err.message || 'No se pudo cargar tu perfil.');
    } finally {
      setIsLoadingProfile(false);
    }
  }, [user?.id, user?.username]);

  const refreshMyReputation = useCallback(async () => {
    if (!user?.id) {
      setMyReputation(null);
      return;
    }

    setIsLoadingReputation(true);
    try {
      const rep = await reputationService.getMe(user.id);
      setMyReputation(rep);
    } catch (err: any) {
      console.warn('[ProfileContext] Error al cargar reputación propia:', err.message);
    } finally {
      setIsLoadingReputation(false);
    }
  }, [user?.id]);

  // Cargar perfil propio y reputación en paralelo al autenticarse
  useEffect(() => {
    if (!isAuthenticated || !user?.id) {
      setMyProfile(null);
      setMyReputation(null);
      return;
    }
    Promise.all([refreshMyProfile(), refreshMyReputation()]).catch(() => {});
  }, [isAuthenticated, user?.id, refreshMyProfile, refreshMyReputation]);

  // Reconciliación HTTP automática cuando el WebSocket se reconecta
  useEffect(() => {
    return onReconnected(() => {
      if (isAuthenticated && user?.id) {
        Promise.all([refreshMyProfile(), refreshMyReputation()]).catch(() => {});
      }
    });
  }, [onReconnected, isAuthenticated, user?.id, refreshMyProfile, refreshMyReputation]);

  // Escuchar eventos en tiempo real: `profile.updated.v1` y `reputation.changed.v1`
  useEffect(() => {
    const unsubProfile = onEvent('profile.updated.v1', ({ payload }) => {
      if (!payload || !payload.userId) return;
      const targetUserId = String(payload.userId);

      setProfilesById((prev) => {
        const existing = prev[targetUserId];
        const base: UserProfile = existing || {
          userId: targetUserId,
          username:
            targetUserId === user?.id
              ? user.username
              : String(payload.displayName || `Explorador_${targetUserId.slice(0, 4)}`),
          displayName: null,
          about: null,
          avatarUrl: null,
          color: colorForUserId(targetUserId),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        const updated: UserProfile = {
          ...base,
          displayName:
            payload.displayName !== undefined ? payload.displayName : base.displayName,
          avatarUrl:
            payload.avatarUrl !== undefined ? payload.avatarUrl : base.avatarUrl,
          color: payload.color ? String(payload.color) : base.color,
          updatedAt: payload.updatedAt || new Date().toISOString(),
        };

        return {
          ...prev,
          [targetUserId]: updated,
        };
      });

      if (user && targetUserId === user.id) {
        setMyProfile((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            displayName:
              payload.displayName !== undefined ? payload.displayName : prev.displayName,
            avatarUrl:
              payload.avatarUrl !== undefined ? payload.avatarUrl : prev.avatarUrl,
            color: payload.color ? String(payload.color) : prev.color,
            updatedAt: payload.updatedAt || new Date().toISOString(),
          };
        });
      }
    });

    const unsubReputation = onEvent('reputation.changed.v1', ({ payload }) => {
      if (!payload || !user?.id) return;
      const targetUserId = String(payload.userId || user.id);
      if (targetUserId !== user.id) return;

      setMyReputation((prev) =>
        reputationService.applyRealtimeDelta(user.id, payload, prev)
      );
    });

    return () => {
      unsubProfile();
      unsubReputation();
    };
  }, [onEvent, user]);

  const resolveProfiles = useCallback(
    async (userIds: string[]): Promise<Record<string, UserProfile>> => {
      const uniqueIds = Array.from(
        new Set(userIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))
      );
      if (uniqueIds.length === 0) return profilesCacheRef.current;

      try {
        const fetched = await profileService.getBatch(uniqueIds);
        if (fetched.length === 0) return profilesCacheRef.current;

        const nextMap: Record<string, UserProfile> = {
          ...profilesCacheRef.current,
        };
        fetched.forEach((p) => {
          if (p && p.userId) {
            nextMap[p.userId] = p;
          }
        });
        setProfilesById(nextMap);
        return nextMap;
      } catch {
        return profilesCacheRef.current;
      }
    },
    []
  );

  const getProfileDisplay = useCallback(
    (userId: string, fallbackName?: string): ProfileDisplayInfo => {
      const cleanId = userId?.trim() || '';
      const isMe = !!user && cleanId === user.id;
      const cached = isMe ? myProfile || profilesById[cleanId] : profilesById[cleanId];

      if (cached) {
        return {
          displayName: cached.displayName || cached.username,
          username: cached.username,
          color: cached.color || colorForUserId(cleanId),
          avatarUrl: cached.avatarUrl || null,
          about: cached.about || null,
        };
      }

      if (isMe && user) {
        return {
          displayName: user.username,
          username: user.username,
          color: user.color || colorForUserId(user.id),
          avatarUrl: null,
          about: null,
        };
      }

      const defaultName = fallbackName || `Explorador ${cleanId.slice(0, 4)}`;
      return {
        displayName: defaultName,
        username: defaultName,
        color: colorForUserId(cleanId),
        avatarUrl: null,
        about: null,
      };
    },
    [myProfile, profilesById, user]
  );

  const updateMyProfile = async (
    dto: UpdateProfileDto
  ): Promise<{ success: boolean; profile?: UserProfile; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para editar tu perfil.' };
    }

    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      const updated = await profileService.updateMe(dto, {
        id: user.id,
        username: user.username,
      });
      setMyProfile(updated);
      setProfilesById((prev) => ({
        ...prev,
        [updated.userId]: updated,
      }));
      return { success: true, profile: updated };
    } catch (err: any) {
      const msg = err.message || 'No se pudo actualizar tu perfil.';
      setProfileError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const uploadMyAvatar = async (
    file: Blob | File
  ): Promise<{ success: boolean; avatarUrl?: string; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión para subir un avatar.' };
    }

    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      const res = await profileService.uploadAvatar(file, {
        id: user.id,
        username: user.username,
      });
      setMyProfile((prev) =>
        prev
          ? {
              ...prev,
              avatarUrl: res.avatarUrl,
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
      setProfilesById((prev) => {
        const existing = prev[user.id];
        if (!existing) return prev;
        return {
          ...prev,
          [user.id]: {
            ...existing,
            avatarUrl: res.avatarUrl,
            updatedAt: new Date().toISOString(),
          },
        };
      });
      return { success: true, avatarUrl: res.avatarUrl };
    } catch (err: any) {
      const msg = err.message || 'No se pudo subir la imagen de avatar.';
      setProfileError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const deleteMyAvatar = async (): Promise<{ success: boolean; error?: string }> => {
    if (!user) {
      return { success: false, error: 'Debes iniciar sesión.' };
    }

    setIsLoadingProfile(true);
    setProfileError(null);
    try {
      await profileService.deleteAvatar({
        id: user.id,
        username: user.username,
      });
      setMyProfile((prev) =>
        prev
          ? {
              ...prev,
              avatarUrl: null,
              updatedAt: new Date().toISOString(),
            }
          : prev
      );
      setProfilesById((prev) => {
        const existing = prev[user.id];
        if (!existing) return prev;
        return {
          ...prev,
          [user.id]: {
            ...existing,
            avatarUrl: null,
            updatedAt: new Date().toISOString(),
          },
        };
      });
      return { success: true };
    } catch (err: any) {
      const msg = err.message || 'No se pudo eliminar el avatar.';
      setProfileError(msg);
      return { success: false, error: msg };
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const recomputeMyReputation = async (): Promise<{
    success: boolean;
    error?: string;
  }> => {
    if (!user?.id) {
      return { success: false, error: 'Debes iniciar sesión.' };
    }

    setIsLoadingReputation(true);
    try {
      const rep = await reputationService.recompute(user.id);
      setMyReputation(rep);
      return { success: true };
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'No se pudo recalcular la reputación.',
      };
    } finally {
      setIsLoadingReputation(false);
    }
  };

  return (
    <ProfileContext.Provider
      value={{
        myProfile,
        myReputation,
        profilesById,
        isLoadingProfile,
        isLoadingReputation,
        profileError,
        refreshMyProfile,
        refreshMyReputation,
        updateMyProfile,
        uploadMyAvatar,
        deleteMyAvatar,
        recomputeMyReputation,
        resolveProfiles,
        getProfileDisplay,
      }}
    >
      {children}
    </ProfileContext.Provider>
  );
};

export const useProfile = (): ProfileContextType => {
  const context = useContext(ProfileContext);
  if (!context) {
    throw new Error('useProfile debe ser utilizado dentro de un ProfileProvider');
  }
  return context;
};
