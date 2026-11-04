import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import {
  ReputationLedgerEntry,
  ReputationLevelName,
  UserReputation,
} from '../../types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Calcula la información de nivel de reputación según los umbrales del backend:
 * 0-49: Novato | 50-149: Miembro | 150-349: Confiable | 350-699: Experto | 700-1000: Leyenda
 */
export function computeLevelForScore(rawScore: number): {
  score: number;
  level: ReputationLevelName;
  levelIndex: number;
  nextLevelAt: number | null;
  progress: number;
} {
  const score = Math.max(0, Math.min(1000, Math.round(rawScore)));
  if (score < 50) {
    return {
      score,
      level: 'Novato',
      levelIndex: 0,
      nextLevelAt: 50,
      progress: score / 50,
    };
  }
  if (score < 150) {
    return {
      score,
      level: 'Miembro',
      levelIndex: 1,
      nextLevelAt: 150,
      progress: (score - 50) / 100,
    };
  }
  if (score < 350) {
    return {
      score,
      level: 'Confiable',
      levelIndex: 2,
      nextLevelAt: 350,
      progress: (score - 150) / 200,
    };
  }
  if (score < 700) {
    return {
      score,
      level: 'Experto',
      levelIndex: 3,
      nextLevelAt: 700,
      progress: (score - 350) / 350,
    };
  }
  return {
    score,
    level: 'Leyenda',
    levelIndex: 4,
    nextLevelAt: null,
    progress: 1.0,
  };
}

function buildMockReputation(
  userId: string,
  score: number,
  likesReceived: number,
  dislikesReceived: number,
  messagesWarned: number = 0,
  messagesBlocked: number = 0
): UserReputation {
  const info = computeLevelForScore(score);
  return {
    userId,
    score: info.score,
    level: info.level,
    levelIndex: info.levelIndex,
    nextLevelAt: info.nextLevelAt,
    progress: info.progress,
    likesReceived,
    dislikesReceived,
    messagesWarned,
    messagesBlocked,
    updatedAt: new Date().toISOString(),
  };
}

const INITIAL_MOCK_LEADERBOARD: UserReputation[] = [
  buildMockReputation('user-demo-3', 740, 360, 4, 0, 0),
  buildMockReputation('user-demo-2', 410, 195, 5, 1, 0),
  buildMockReputation('user-demo-1', 168, 82, 3, 1, 0),
  buildMockReputation('user-demo-6', 124, 60, 2, 0, 0),
  buildMockReputation('user-demo-4', 76, 36, 1, 0, 0),
  buildMockReputation('user-demo-5', 38, 18, 1, 0, 0),
];

const INITIAL_MOCK_HISTORY: ReputationLedgerEntry[] = [
  {
    id: 'ledger-mock-1',
    userId: 'user-demo-1',
    delta: 2,
    appliedDelta: 2,
    reason: 'LIKE_RECEIVED',
    sourceEventId: '0192f3a4-0001-7000-8000-000000000001',
    dedupeKey: 'rating:bta-unal-1:voter-1',
    scoreAfter: 168,
    createdAt: new Date(Date.now() - 15 * 60 * 1000).toISOString(),
  },
  {
    id: 'ledger-mock-2',
    userId: 'user-demo-1',
    delta: 1,
    appliedDelta: 1,
    reason: 'MESSAGE_ALLOWED',
    sourceEventId: '0192f3a4-0001-7000-8000-000000000002',
    dedupeKey: 'moderation:bta-unal-1:allow',
    scoreAfter: 166,
    createdAt: new Date(Date.now() - 2 * 3600 * 1000).toISOString(),
  },
  {
    id: 'ledger-mock-3',
    userId: 'user-demo-1',
    delta: 2,
    appliedDelta: 2,
    reason: 'LIKE_RECEIVED',
    sourceEventId: '0192f3a4-0001-7000-8000-000000000003',
    dedupeKey: 'rating:bta-centro-3:voter-2',
    scoreAfter: 165,
    createdAt: new Date(Date.now() - 5 * 3600 * 1000).toISOString(),
  },
  {
    id: 'ledger-mock-4',
    userId: 'user-demo-1',
    delta: -3,
    appliedDelta: -3,
    reason: 'MESSAGE_WARNED',
    sourceEventId: '0192f3a4-0001-7000-8000-000000000004',
    dedupeKey: 'moderation:bta-old-1:warn',
    scoreAfter: 163,
    createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
  },
];

class ReputationService {
  private mockReputations = new Map<string, UserReputation>(
    INITIAL_MOCK_LEADERBOARD.map((r) => [r.userId, r])
  );
  private mockHistory: ReputationLedgerEntry[] = [...INITIAL_MOCK_HISTORY];

  private ensureMockReputation(userId: string): UserReputation {
    const existing = this.mockReputations.get(userId);
    if (existing) return existing;
    const created = buildMockReputation(userId, 12, 5, 0, 0, 0);
    this.mockReputations.set(userId, created);
    return created;
  }

  /**
   * Consulta la reputación del usuario en sesión (`GET /api/reputation/me`).
   */
  public async getMe(fallbackUserId?: string): Promise<UserReputation> {
    if (API_CONFIG.USE_MOCKS) {
      return this.ensureMockReputation(fallbackUserId || 'user-demo-1');
    }

    try {
      const rep = await apiClient.requestRaw<UserReputation>(
        API_CONFIG.ROUTES.REPUTATION.ME,
        { method: 'GET' }
      );
      if (rep && rep.userId) {
        this.mockReputations.set(rep.userId, rep);
      }
      return rep;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.ensureMockReputation(fallbackUserId || 'user-demo-1');
      }
      throw error;
    }
  }

  /**
   * Consulta la reputación de un usuario específico (`GET /api/reputation/{userId}`).
   */
  public async getByUserId(userId: string): Promise<UserReputation> {
    const cleanId = userId.trim();
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(cleanId)) {
      return this.ensureMockReputation(cleanId || 'user-demo-1');
    }

    try {
      const rep = await apiClient.requestRaw<UserReputation>(
        API_CONFIG.ROUTES.REPUTATION.BY_USER(cleanId),
        { method: 'GET' }
      );
      if (rep && rep.userId) {
        this.mockReputations.set(rep.userId, rep);
      }
      return rep;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.ensureMockReputation(cleanId);
      }
      throw error;
    }
  }

  /**
   * Obtiene el leaderboard ordenado por puntaje descendente (`GET /api/reputation/leaderboard`).
   */
  public async getLeaderboard(
    limit: number = 20,
    cursor?: string
  ): Promise<UserReputation[]> {
    if (API_CONFIG.USE_MOCKS) {
      return Array.from(this.mockReputations.values())
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    }

    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set('cursor', cursor);

      const list = await apiClient.requestRaw<UserReputation[]>(
        `${API_CONFIG.ROUTES.REPUTATION.LEADERBOARD}?${params.toString()}`,
        { method: 'GET' }
      );
      return Array.isArray(list) ? list : [];
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return Array.from(this.mockReputations.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, limit);
      }
      throw error;
    }
  }

  /**
   * Obtiene el historial paginado de movimientos en el ledger (`GET /api/reputation/{userId}/history`).
   */
  public async getHistory(
    userId: string,
    limit: number = 20,
    cursor?: string
  ): Promise<ReputationLedgerEntry[]> {
    const cleanId = userId.trim();
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(cleanId)) {
      return this.mockHistory.slice(0, limit);
    }

    try {
      const params = new URLSearchParams({ limit: String(limit) });
      if (cursor) params.set('cursor', cursor);

      const entries = await apiClient.requestRaw<ReputationLedgerEntry[]>(
        `${API_CONFIG.ROUTES.REPUTATION.HISTORY(cleanId)}?${params.toString()}`,
        { method: 'GET' }
      );
      return Array.isArray(entries) ? entries : [];
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockHistory.slice(0, limit);
      }
      throw error;
    }
  }

  /**
   * Reconstruye el puntaje de reputación a partir del ledger (`POST /api/reputation/{userId}/recompute`).
   */
  public async recompute(userId: string): Promise<UserReputation> {
    const cleanId = userId.trim();
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(cleanId)) {
      return this.ensureMockReputation(cleanId || 'user-demo-1');
    }

    try {
      const rep = await apiClient.requestRaw<UserReputation>(
        API_CONFIG.ROUTES.REPUTATION.RECOMPUTE(cleanId),
        { method: 'POST' }
      );
      if (rep && rep.userId) {
        this.mockReputations.set(rep.userId, rep);
      }
      return rep;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.ensureMockReputation(cleanId);
      }
      throw error;
    }
  }

  /**
   * Aplica localmente un cambio recibido por evento `reputation.changed.v1`
   * para mantener sincronizada la interfaz y el modo mock.
   */
  public applyRealtimeDelta(
    userId: string,
    payload: {
      score?: number;
      delta?: number;
      level?: string;
      reason?: string;
      occurredAt?: string;
    },
    current?: UserReputation | null
  ): UserReputation {
    const base = current || this.ensureMockReputation(userId);
    const nextScore =
      typeof payload.score === 'number'
        ? payload.score
        : Math.max(0, Math.min(1000, base.score + Number(payload.delta ?? 0)));
    const info = computeLevelForScore(nextScore);
    const reason = String(payload.reason || 'LIKE_RECEIVED');

    const updated: UserReputation = {
      ...base,
      userId,
      score: info.score,
      level: (payload.level as ReputationLevelName) || info.level,
      levelIndex: info.levelIndex,
      nextLevelAt: info.nextLevelAt,
      progress: info.progress,
      likesReceived:
        reason === 'LIKE_RECEIVED' ? base.likesReceived + 1 : base.likesReceived,
      dislikesReceived:
        reason === 'DISLIKE_RECEIVED' ? base.dislikesReceived + 1 : base.dislikesReceived,
      messagesWarned:
        reason === 'MESSAGE_WARNED' ? base.messagesWarned + 1 : base.messagesWarned,
      messagesBlocked:
        reason === 'MESSAGE_BLOCKED' ? base.messagesBlocked + 1 : base.messagesBlocked,
      updatedAt: payload.occurredAt || new Date().toISOString(),
    };

    this.mockReputations.set(userId, updated);

    if (typeof payload.delta === 'number' && payload.delta !== 0) {
      this.mockHistory.unshift({
        id: `ledger-${Date.now()}`,
        userId,
        delta: payload.delta,
        appliedDelta: payload.delta,
        reason,
        sourceEventId: `evt-${Date.now()}`,
        dedupeKey: `rt:${Date.now()}`,
        scoreAfter: updated.score,
        createdAt: updated.updatedAt,
      });
    }

    return updated;
  }
}

export const reputationService = new ReputationService();
