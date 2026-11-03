import { API_CONFIG } from '../../config/api.config';
import { apiClient, isNetworkError } from '../api/apiClient';
import { socketService } from '../realtime/socketService';
import { RatingSummary } from '../../types';

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeRatingSummary(raw: any, fallbackMessageId?: string): RatingSummary {
  const likes = typeof raw?.likes === 'number' ? raw.likes : 0;
  const dislikes = typeof raw?.dislikes === 'number' ? raw.dislikes : 0;
  const score = typeof raw?.score === 'number' ? raw.score : likes - dislikes;
  const rawVote = raw?.myRating ?? raw?.userRating ?? null;
  const myRating: 'LIKE' | 'DISLIKE' | null =
    rawVote === 'LIKE' || rawVote === 'DISLIKE' ? rawVote : null;

  return {
    messageId: String(raw?.messageId || fallbackMessageId || ''),
    likes,
    dislikes,
    score,
    myRating,
  };
}

class RatingService {
  private mockRatings = new Map<string, RatingSummary>([
    [
      'bta-unal-1',
      { messageId: 'bta-unal-1', likes: 8, dislikes: 1, score: 7, myRating: null },
    ],
    [
      'bta-unal-2',
      { messageId: 'bta-unal-2', likes: 5, dislikes: 0, score: 5, myRating: 'LIKE' },
    ],
    [
      'bta-unal-3',
      { messageId: 'bta-unal-3', likes: 12, dislikes: 1, score: 11, myRating: null },
    ],
    [
      'bta-unal-4',
      { messageId: 'bta-unal-4', likes: 6, dislikes: 0, score: 6, myRating: null },
    ],
    [
      'bta-unal-5',
      { messageId: 'bta-unal-5', likes: 4, dislikes: 1, score: 3, myRating: null },
    ],
  ]);

  private getOrCreateMockSummary(messageId: string): RatingSummary {
    const existing = this.mockRatings.get(messageId);
    if (existing) return existing;
    const initial: RatingSummary = {
      messageId,
      likes: 0,
      dislikes: 0,
      score: 0,
      myRating: null,
    };
    this.mockRatings.set(messageId, initial);
    return initial;
  }

  /**
   * Registra un voto `LIKE` o `DISLIKE` sobre un mensaje (`PUT /api/ratings/messages/{messageId}`).
   */
  public async rateMessage(
    messageId: string,
    value: 'LIKE' | 'DISLIKE'
  ): Promise<RatingSummary> {
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(messageId)) {
      return this.mockVote(messageId, value);
    }

    try {
      const raw = await apiClient.requestRaw<any>(
        API_CONFIG.ROUTES.RATINGS.BY_MESSAGE(messageId),
        {
          method: 'PUT',
          body: JSON.stringify({ value }),
        }
      );
      const summary = normalizeRatingSummary(raw, messageId);
      this.mockRatings.set(messageId, summary);
      return summary;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockVote(messageId, value);
      }
      throw error;
    }
  }

  /**
   * Quita el voto del usuario actual sobre un mensaje (`DELETE /api/ratings/messages/{messageId}`).
   */
  public async removeRating(messageId: string): Promise<RatingSummary> {
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(messageId)) {
      return this.mockVote(messageId, null);
    }

    try {
      const raw = await apiClient.requestRaw<any>(
        API_CONFIG.ROUTES.RATINGS.BY_MESSAGE(messageId),
        {
          method: 'DELETE',
        }
      );
      const summary = normalizeRatingSummary(raw, messageId);
      this.mockRatings.set(messageId, summary);
      return summary;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.mockVote(messageId, null);
      }
      throw error;
    }
  }

  /**
   * Consulta el resumen de calificaciones de un mensaje (`GET /api/ratings/messages/{messageId}`).
   */
  public async getMessageRating(messageId: string): Promise<RatingSummary> {
    if (API_CONFIG.USE_MOCKS || !UUID_REGEX.test(messageId)) {
      return this.getOrCreateMockSummary(messageId);
    }

    try {
      const raw = await apiClient.requestRaw<any>(
        API_CONFIG.ROUTES.RATINGS.BY_MESSAGE(messageId),
        {
          method: 'GET',
        }
      );
      const summary = normalizeRatingSummary(raw, messageId);
      this.mockRatings.set(messageId, summary);
      return summary;
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return this.getOrCreateMockSummary(messageId);
      }
      throw error;
    }
  }

  /**
   * Consulta en lote los resúmenes de hasta 100 mensajes (`POST /api/ratings/messages/batch`).
   */
  public async getBatchRatings(messageIds: string[]): Promise<RatingSummary[]> {
    const uniqueIds = Array.from(
      new Set(messageIds.map((id) => id?.trim()).filter((id): id is string => Boolean(id)))
    ).slice(0, 100);

    if (uniqueIds.length === 0) return [];

    if (API_CONFIG.USE_MOCKS) {
      return uniqueIds.map((id) => this.getOrCreateMockSummary(id));
    }

    const validUuids = uniqueIds.filter((id) => UUID_REGEX.test(id));
    const nonUuidSummaries = uniqueIds
      .filter((id) => !UUID_REGEX.test(id))
      .map((id) => this.getOrCreateMockSummary(id));

    if (validUuids.length === 0) {
      return nonUuidSummaries;
    }

    try {
      const rawList = await apiClient.requestRaw<any[]>(API_CONFIG.ROUTES.RATINGS.BATCH, {
        method: 'POST',
        body: JSON.stringify({ messageIds: validUuids }),
      });

      const summaries = Array.isArray(rawList)
        ? rawList.map((item) => normalizeRatingSummary(item))
        : [];

      summaries.forEach((s) => {
        if (s.messageId) {
          this.mockRatings.set(s.messageId, s);
        }
      });

      return [...summaries, ...nonUuidSummaries];
    } catch (error: any) {
      if (API_CONFIG.AUTO_FALLBACK_TO_MOCK && isNetworkError(error)) {
        return uniqueIds.map((id) => this.getOrCreateMockSummary(id));
      }
      return nonUuidSummaries;
    }
  }

  // ==========================================
  // Métodos de simulación (Mock / Fallback)
  // ==========================================

  private mockVote(
    messageId: string,
    nextVote: 'LIKE' | 'DISLIKE' | null
  ): RatingSummary {
    const current = this.getOrCreateMockSummary(messageId);
    let likes = current.likes;
    let dislikes = current.dislikes;

    if (current.myRating === 'LIKE') likes = Math.max(0, likes - 1);
    if (current.myRating === 'DISLIKE') dislikes = Math.max(0, dislikes - 1);

    if (nextVote === 'LIKE') likes += 1;
    if (nextVote === 'DISLIKE') dislikes += 1;

    const updated: RatingSummary = {
      messageId,
      likes,
      dislikes,
      score: likes - dislikes,
      myRating: nextVote,
    };

    this.mockRatings.set(messageId, updated);

    socketService.emitMockEvent('rating.changed.v1', {
      messageId,
      likes: updated.likes,
      dislikes: updated.dislikes,
      score: updated.score,
      value: nextVote === 'LIKE' ? 1 : nextVote === 'DISLIKE' ? -1 : 0,
    });

    return updated;
  }
}

export const ratingService = new RatingService();
