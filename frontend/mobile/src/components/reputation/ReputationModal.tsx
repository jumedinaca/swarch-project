import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  ReputationLedgerEntry,
  UserProfile,
  UserReputation,
} from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useRealtime } from '../../context/RealtimeContext';
import { reputationService } from '../../services/reputation/reputationService';
import { colorForUserId } from '../../services/profile/profileService';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';

interface ReputationModalProps {
  visible: boolean;
  onClose: () => void;
  onSelectUserProfile?: (userId: string) => void;
}

type RepTab = 'overview' | 'leaderboard' | 'history';

const LEVEL_ROADMAP = [
  { level: 'Novato', range: '0 – 49 pts', icon: 'leaf-outline', color: '#525B62' },
  { level: 'Miembro', range: '50 – 149 pts', icon: 'shield-outline', color: '#2A5D84' },
  { level: 'Confiable', range: '150 – 349 pts', icon: 'ribbon-outline', color: '#2D6A4F' },
  { level: 'Experto', range: '350 – 699 pts', icon: 'star-outline', color: '#8A5A00' },
  { level: 'Leyenda', range: '700 – 1000 pts', icon: 'trophy-outline', color: '#B52B32' },
];

function formatLedgerReason(reason: string): { label: string; icon: string } {
  switch (reason) {
    case 'LIKE_RECEIVED':
      return { label: 'Like recibido en PictoNota', icon: 'thumbs-up-outline' };
    case 'DISLIKE_RECEIVED':
      return { label: 'Dislike recibido en PictoNota', icon: 'thumbs-down-outline' };
    case 'MESSAGE_ALLOWED':
      return { label: 'Nota aprobada por moderación', icon: 'checkmark-circle-outline' };
    case 'MESSAGE_WARNED':
      return { label: 'Nota marcada con advertencia', icon: 'warning-outline' };
    case 'MESSAGE_BLOCKED':
      return { label: 'Nota bloqueada por moderación', icon: 'ban-outline' };
    default:
      return { label: reason, icon: 'flash-outline' };
  }
}

export const ReputationModal: React.FC<ReputationModalProps> = ({
  visible,
  onClose,
  onSelectUserProfile,
}) => {
  const { user } = useAuth();
  const {
    myProfile,
    myReputation,
    profilesById,
    resolveProfiles,
    refreshMyReputation,
    recomputeMyReputation,
  } = useProfile();
  const { connectionState, connectionId, simulateRealtimeEvent } = useRealtime();

  const [activeTab, setActiveTab] = useState<RepTab>('overview');
  const [leaderboard, setLeaderboard] = useState<UserReputation[]>([]);
  const [history, setHistory] = useState<ReputationLedgerEntry[]>([]);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [isRecomputing, setIsRecomputing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const loadLeaderboardAndHistory = useCallback(async () => {
    if (!user?.id) return;
    setIsLoadingData(true);
    try {
      const [board, hist] = await Promise.all([
        reputationService.getLeaderboard(20).catch(() => [] as UserReputation[]),
        reputationService.getHistory(user.id, 25).catch(() => [] as ReputationLedgerEntry[]),
      ]);
      setLeaderboard(board);
      setHistory(hist);

      if (board.length > 0) {
        const ids = board.map((entry) => entry.userId).filter(Boolean);
        await resolveProfiles(ids);
      }
    } finally {
      setIsLoadingData(false);
    }
  }, [user?.id, resolveProfiles]);

  useEffect(() => {
    if (!visible) return;
    setFeedback(null);
    refreshMyReputation();
    loadLeaderboardAndHistory();
  }, [visible, refreshMyReputation, loadLeaderboardAndHistory]);

  const handleRecompute = async () => {
    setIsRecomputing(true);
    setFeedback(null);
    try {
      const res = await recomputeMyReputation();
      if (res.success) {
        await loadLeaderboardAndHistory();
        setFeedback('Puntaje recalculado desde el ledger inmutable.');
      } else {
        setFeedback(res.error || 'No se pudo recalcular.');
      }
    } finally {
      setIsRecomputing(false);
    }
  };

  const handleSimulateLikeEvent = () => {
    if (!user?.id) return;
    const nextScore = Math.min(1000, (myReputation?.score ?? 0) + 2);
    simulateRealtimeEvent('reputation.changed.v1', {
      userId: user.id,
      score: nextScore,
      delta: 2,
      level: myReputation?.level || 'Novato',
      levelChanged: false,
      reason: 'LIKE_RECEIVED',
      occurredAt: new Date().toISOString(),
    });
    loadLeaderboardAndHistory();
  };

  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round((myReputation?.progress ?? 0) * 100))
  );

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleDateString([], {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <View style={styles.modalBackdrop} />
        </TouchableOpacity>

        <View style={styles.modalCard}>
          {/* Cabecera */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerIconBox}>
                <Ionicons name="trophy" size={14} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>REPUTACIÓN // RANKING</Text>
                <Text style={styles.headerSubtitle}>
                  NIVEL DE EXPLORADOR, LEADERBOARD Y LEDGER
                </Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.refreshBtn}
                onPress={() => {
                  refreshMyReputation();
                  loadLeaderboardAndHistory();
                }}
              >
                <Ionicons
                  name="refresh"
                  size={14}
                  color={nintendoTheme.colors.textPrimary}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons
                  name="close"
                  size={18}
                  color={nintendoTheme.colors.textSecondary}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Barra de pestañas */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'overview' && styles.tabBtnActive]}
              onPress={() => setActiveTab('overview')}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'overview' && styles.tabBtnTextActive,
                ]}
              >
                MI NIVEL
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'leaderboard' && styles.tabBtnActive]}
              onPress={() => setActiveTab('leaderboard')}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'leaderboard' && styles.tabBtnTextActive,
                ]}
              >
                RANKING [{leaderboard.length}]
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'history' && styles.tabBtnActive]}
              onPress={() => setActiveTab('history')}
            >
              <Text
                style={[
                  styles.tabBtnText,
                  activeTab === 'history' && styles.tabBtnTextActive,
                ]}
              >
                HISTORIAL
              </Text>
            </TouchableOpacity>
          </View>

          {/* Pestaña 1: MI NIVEL */}
          {activeTab === 'overview' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <View>
                    <Text style={styles.heroLabel}>RANGO ACTUAL</Text>
                    <Text style={styles.heroLevelText}>
                      {(myReputation?.level || 'Novato').toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.heroScoreBox}>
                    <Text style={styles.heroScoreNumber}>
                      {myReputation?.score ?? 0}
                    </Text>
                    <Text style={styles.heroScoreUnit}>/ 1000 PTS</Text>
                  </View>
                </View>

                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      {
                        width: `${progressPercent}%`,
                        backgroundColor:
                          myProfile?.color || nintendoTheme.colors.miiverseGreen,
                      },
                    ]}
                  />
                </View>

                <View style={styles.heroBottomRow}>
                  <Text style={styles.heroMetaText}>
                    {myReputation?.nextLevelAt
                      ? `Progreso: ${progressPercent}% · Siguiente nivel a los ${myReputation.nextLevelAt} pts`
                      : '¡Nivel máximo Leyenda alcanzado!'}
                  </Text>
                  <TouchableOpacity
                    style={styles.recomputeBtn}
                    onPress={handleRecompute}
                    disabled={isRecomputing}
                  >
                    <Ionicons
                      name="calculator-outline"
                      size={11}
                      color={nintendoTheme.colors.textPrimary}
                    />
                    <Text style={styles.recomputeText}>
                      {isRecomputing ? 'CALCULANDO...' : 'RECALCULAR'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              {feedback && (
                <View style={styles.feedbackBox}>
                  <Ionicons name="checkmark-circle" size={13} color="#275E33" />
                  <Text style={styles.feedbackText}>{feedback}</Text>
                </View>
              )}

              {/* Contadores de actividad */}
              <View style={styles.statsGrid}>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    +{myReputation?.likesReceived ?? 0}
                  </Text>
                  <Text style={styles.statTitle}>LIKES RECIBIDOS (+2 pts)</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {myReputation?.dislikesReceived ?? 0}
                  </Text>
                  <Text style={styles.statTitle}>DISLIKES (-2 pts)</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {myReputation?.messagesWarned ?? 0}
                  </Text>
                  <Text style={styles.statTitle}>ADVERTENCIAS (-3 pts)</Text>
                </View>
                <View style={styles.statCard}>
                  <Text style={styles.statValue}>
                    {myReputation?.messagesBlocked ?? 0}
                  </Text>
                  <Text style={styles.statTitle}>BLOQUEOS (-10 pts)</Text>
                </View>
              </View>

              {/* Escalafón de niveles */}
              <View style={styles.roadmapBox}>
                <Text style={styles.sectionTitle}>ESCALAFÓN DE EXPLORADORES</Text>
                {LEVEL_ROADMAP.map((item) => {
                  const isCurrent =
                    (myReputation?.level || 'Novato').toLowerCase() ===
                    item.level.toLowerCase();
                  return (
                    <View
                      key={item.level}
                      style={[
                        styles.roadmapRow,
                        isCurrent && styles.roadmapRowActive,
                      ]}
                    >
                      <Ionicons
                        name={item.icon as any}
                        size={14}
                        color={item.color}
                      />
                      <Text
                        style={[
                          styles.roadmapLevel,
                          isCurrent && { color: item.color, fontWeight: '800' },
                        ]}
                      >
                        {item.level.toUpperCase()}
                      </Text>
                      <Text style={styles.roadmapRange}>{item.range}</Text>
                      {isCurrent && (
                        <View style={styles.currentTag}>
                          <Text style={styles.currentTagText}>ACTUAL</Text>
                        </View>
                      )}
                    </View>
                  );
                })}
              </View>

              {/* Estado del canal Realtime WebSocket */}
              <View style={styles.realtimeStatusCard}>
                <View style={styles.rtTopRow}>
                  <View style={styles.rtTitleGroup}>
                    <View
                      style={[
                        styles.rtDot,
                        {
                          backgroundColor:
                            connectionState === 'connected'
                              ? '#2AC769'
                              : connectionState === 'connecting' ||
                                connectionState === 'reconnecting'
                              ? '#F59E0B'
                              : '#9CA3AF',
                        },
                      ]}
                    />
                    <Text style={styles.rtTitle}>
                      CANAL REALTIME WS: {connectionState.toUpperCase()}
                    </Text>
                  </View>
                  {connectionId && (
                    <Text style={styles.rtConnId}>ID: {connectionId}</Text>
                  )}
                </View>
                <View style={styles.rtActionsRow}>
                  <TouchableOpacity
                    style={styles.simBtn}
                    onPress={handleSimulateLikeEvent}
                  >
                    <Ionicons
                      name="sparkles-outline"
                      size={12}
                      color={nintendoTheme.colors.wiiBlue}
                    />
                    <Text style={styles.simBtnText}>
                      PROBAR EVENTO REALTIME (+2 PTS)
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          )}

          {/* Pestaña 2: RANKING (Leaderboard) */}
          {activeTab === 'leaderboard' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {isLoadingData && leaderboard.length === 0 ? (
                <View style={styles.emptyBox}>
                  <ActivityIndicator
                    size="small"
                    color={nintendoTheme.colors.retroDpad}
                  />
                  <Text style={styles.emptyText}>CARGANDO LEADERBOARD...</Text>
                </View>
              ) : leaderboard.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="podium-outline" size={32} color="#B0B8BF" />
                  <Text style={styles.emptyText}>
                    AÚN NO HAY REGISTROS EN EL LEADERBOARD.
                  </Text>
                </View>
              ) : (
                leaderboard.map((entry, idx) => {
                  const isMe = entry.userId === user?.id;
                  const prof: UserProfile | undefined = isMe
                    ? myProfile || profilesById[entry.userId]
                    : profilesById[entry.userId];
                  const name = prof
                    ? prof.displayName || prof.username
                    : isMe && user
                    ? user.username
                    : `Explorador ${entry.userId.slice(0, 6)}`;
                  const color = prof?.color || colorForUserId(entry.userId);
                  const avatarUrl = prof?.avatarUrl || null;

                  return (
                    <TouchableOpacity
                      key={entry.userId}
                      style={[
                        styles.leaderRow,
                        isMe && styles.leaderRowMe,
                      ]}
                      activeOpacity={0.75}
                      onPress={() => {
                        if (onSelectUserProfile) {
                          onClose();
                          onSelectUserProfile(entry.userId);
                        }
                      }}
                    >
                      <View
                        style={[
                          styles.rankBadge,
                          idx === 0 && styles.rankGold,
                          idx === 1 && styles.rankSilver,
                          idx === 2 && styles.rankBronze,
                        ]}
                      >
                        <Text style={styles.rankText}>#{idx + 1}</Text>
                      </View>

                      <View style={[styles.leaderAvatar, { borderColor: color }]}>
                        {avatarUrl ? (
                          <Image
                            source={{ uri: avatarUrl }}
                            style={styles.leaderAvatarImg}
                          />
                        ) : (
                          <View
                            style={[
                              styles.leaderAvatarFallback,
                              { backgroundColor: color },
                            ]}
                          >
                            <Text style={styles.leaderAvatarLetter}>
                              {name.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        )}
                      </View>

                      <View style={styles.leaderInfo}>
                        <View style={styles.leaderNameRow}>
                          <Text style={styles.leaderName} numberOfLines={1}>
                            {name}
                          </Text>
                          {isMe && (
                            <View style={styles.meChip}>
                              <Text style={styles.meChipText}>TÚ</Text>
                            </View>
                          )}
                        </View>
                        <Text style={styles.leaderMeta}>
                          {entry.level.toUpperCase()} · 👍 {entry.likesReceived}
                        </Text>
                      </View>

                      <View style={styles.leaderScoreCol}>
                        <Text style={styles.leaderScoreVal}>{entry.score}</Text>
                        <Text style={styles.leaderScoreUnit}>PTS</Text>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Pestaña 3: HISTORIAL (Ledger) */}
          {activeTab === 'history' && (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {isLoadingData && history.length === 0 ? (
                <View style={styles.emptyBox}>
                  <ActivityIndicator
                    size="small"
                    color={nintendoTheme.colors.retroDpad}
                  />
                  <Text style={styles.emptyText}>CARGANDO HISTORIAL...</Text>
                </View>
              ) : history.length === 0 ? (
                <View style={styles.emptyBox}>
                  <Ionicons name="receipt-outline" size={32} color="#B0B8BF" />
                  <Text style={styles.emptyText}>
                    SIN MOVIMIENTOS EN TU LEDGER DE REPUTACIÓN AÚN.
                  </Text>
                </View>
              ) : (
                history.map((item) => {
                  const info = formatLedgerReason(item.reason);
                  const isPositive = item.appliedDelta >= 0;
                  return (
                    <View key={item.id} style={styles.ledgerRow}>
                      <View
                        style={[
                          styles.ledgerIconBox,
                          isPositive ? styles.ledgerIconPos : styles.ledgerIconNeg,
                        ]}
                      >
                        <Ionicons
                          name={info.icon as any}
                          size={14}
                          color={
                            isPositive
                              ? nintendoTheme.colors.miiverseGreen
                              : nintendoTheme.colors.famicomRed
                          }
                        />
                      </View>

                      <View style={styles.ledgerInfo}>
                        <Text style={styles.ledgerReason}>{info.label}</Text>
                        <Text style={styles.ledgerDate}>
                          {formatDate(item.createdAt)} · Total: {item.scoreAfter} pts
                        </Text>
                      </View>

                      <Text
                        style={[
                          styles.ledgerDelta,
                          isPositive ? styles.deltaPos : styles.deltaNeg,
                        ]}
                      >
                        {item.appliedDelta > 0
                          ? `+${item.appliedDelta}`
                          : item.appliedDelta}{' '}
                        PTS
                      </Text>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          <View style={styles.footerRow}>
            <WiiButton
              title="CERRAR"
              variant="secondary"
              onPress={onClose}
              style={{ width: '100%' }}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(20, 24, 28, 0.55)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.borderDark,
    padding: 14,
    ...nintendoTheme.shadows.pictoCard,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconBox: {
    width: 24,
    height: 24,
    borderRadius: 3,
    backgroundColor: '#8A5A00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerSubtitle: {
    fontSize: 9,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  refreshBtn: {
    width: 26,
    height: 26,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    padding: 4,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#ECEAE3',
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 2,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 6,
    alignItems: 'center',
    borderRadius: 2,
  },
  tabBtnActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBC7BD',
  },
  tabBtnText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  tabBtnTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '800',
  },
  scrollArea: {
    marginTop: 10,
    maxHeight: 380,
  },
  scrollContent: {
    gap: 10,
    paddingBottom: 6,
  },
  heroCard: {
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    padding: 12,
    gap: 8,
  },
  heroTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  heroLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  heroLevelText: {
    fontSize: 18,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  heroScoreBox: {
    alignItems: 'flex-end',
  },
  heroScoreNumber: {
    fontSize: 20,
    fontWeight: '800',
    color: nintendoTheme.colors.miiverseGreen,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  heroScoreUnit: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  progressTrack: {
    height: 9,
    backgroundColor: '#E2DFD8',
    borderRadius: 5,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 5,
  },
  heroBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  heroMetaText: {
    fontSize: 9,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  recomputeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 3,
    paddingHorizontal: 7,
  },
  recomputeText: {
    fontSize: 8,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  feedbackBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EDF5EE',
    borderWidth: 1,
    borderColor: '#C2DEC5',
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 7,
  },
  feedbackText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#275E33',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statCard: {
    width: '48%',
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 8,
  },
  statValue: {
    fontSize: 14,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statTitle: {
    fontSize: 8,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  roadmapBox: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 10,
    gap: 5,
  },
  sectionTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 2,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  roadmapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 3,
  },
  roadmapRowActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#D4D0C6',
  },
  roadmapLevel: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    width: 90,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  roadmapRange: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  currentTag: {
    backgroundColor: nintendoTheme.colors.miiverseGreenLight,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.miiverseGreenBorder,
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  currentTagText: {
    fontSize: 8,
    fontWeight: '800',
    color: nintendoTheme.colors.miiverseGreen,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  realtimeStatusCard: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 10,
    gap: 6,
  },
  rtTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rtTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  rtDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  rtTitle: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rtConnId: {
    fontSize: 8,
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rtActionsRow: {
    flexDirection: 'row',
  },
  simBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  simBtnText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.wiiBlue,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyBox: {
    padding: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textMuted,
    textAlign: 'center',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 8,
  },
  leaderRowMe: {
    backgroundColor: '#EDF5EE',
    borderColor: '#C2DEC5',
  },
  rankBadge: {
    width: 26,
    height: 22,
    borderRadius: 3,
    backgroundColor: '#ECEAE3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rankGold: {
    backgroundColor: '#FEF3C7',
  },
  rankSilver: {
    backgroundColor: '#E5E7EB',
  },
  rankBronze: {
    backgroundColor: '#FFEDD5',
  },
  rankText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderAvatar: {
    width: 28,
    height: 28,
    borderRadius: 3,
    borderWidth: 1.5,
    padding: 1,
  },
  leaderAvatarImg: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
  },
  leaderAvatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaderAvatarLetter: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderInfo: {
    flex: 1,
  },
  leaderNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  leaderName: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  meChip: {
    backgroundColor: nintendoTheme.colors.miiverseGreenLight,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.miiverseGreenBorder,
    borderRadius: 2,
    paddingHorizontal: 4,
  },
  meChipText: {
    fontSize: 7,
    fontWeight: '800',
    color: nintendoTheme.colors.miiverseGreen,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderMeta: {
    fontSize: 9,
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderScoreCol: {
    alignItems: 'flex-end',
  },
  leaderScoreVal: {
    fontSize: 13,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  leaderScoreUnit: {
    fontSize: 7,
    fontWeight: '700',
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  ledgerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 8,
  },
  ledgerIconBox: {
    width: 26,
    height: 26,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ledgerIconPos: {
    backgroundColor: '#EDF5EE',
  },
  ledgerIconNeg: {
    backgroundColor: nintendoTheme.colors.famicomRedLight,
  },
  ledgerInfo: {
    flex: 1,
  },
  ledgerReason: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  ledgerDate: {
    fontSize: 9,
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  ledgerDelta: {
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  deltaPos: {
    color: '#275E33',
  },
  deltaNeg: {
    color: nintendoTheme.colors.famicomRed,
  },
  footerRow: {
    marginTop: 10,
  },
});
