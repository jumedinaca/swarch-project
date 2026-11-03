import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';
import { profileService } from '../../services/profile/profileService';
import { UserProfile } from '../../types';

interface NetworkModalProps {
  visible: boolean;
  onClose: () => void;
}

type TabType = 'friends' | 'requests' | 'add';
type RequestSubTab = 'incoming' | 'outgoing';

function profileName(profile?: UserProfile | null): string {
  return profile?.displayName || profile?.username || 'Explorador';
}

function profileHandle(profile?: UserProfile | null): string {
  return profile?.username ? `@${profile.username}` : '';
}

export const NetworkModal: React.FC<NetworkModalProps> = ({ visible, onClose }) => {
  const { user } = useAuth();
  const {
    friends,
    incomingRequests,
    outgoingRequests,
    pendingCount,
    sendFriendRequest,
    acceptFriendRequest,
    rejectFriendRequest,
    cancelFriendRequest,
    removeFriend,
    refreshNetwork,
    getRelationshipStatus,
    isLoading,
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [requestSubTab, setRequestSubTab] = useState<RequestSubTab>('incoming');

  // Estado de búsqueda y envío de solicitudes
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Copiar nombre de usuario al portapapeles
  const handleCopyUsername = (usernameToCopy: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(`@${usernameToCopy}`);
      }
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } catch {
      Alert.alert('Usuario copiado', `@${usernameToCopy}`);
    }
  };

  const handleSearch = async () => {
    setFormError(null);
    setFormSuccess(null);
    const query = searchQuery.trim();
    if (query.length < 2) {
      setFormError('Escribe al menos 2 caracteres del nombre de usuario.');
      return;
    }

    setIsSearching(true);
    setHasSearched(true);
    try {
      const res = await profileService.search(query, 10);
      if (!res.success || !res.data) {
        setSearchResults([]);
        setFormError(res.error || 'No se pudo buscar exploradores.');
        return;
      }
      setSearchResults(res.data.filter((profile) => profile.userId !== user?.id));
    } finally {
      setIsSearching(false);
    }
  };

  // Manejo de envío de solicitud a un perfil encontrado
  const handleSendRequest = async (profile: UserProfile) => {
    setFormError(null);
    setFormSuccess(null);

    setIsSubmitting(true);
    try {
      const res = await sendFriendRequest(profile.userId);
      if (res.success) {
        setFormSuccess(`¡Solicitud enviada a ${profileHandle(profile)}!`);
        setSearchResults((prev) => prev.filter((item) => item.userId !== profile.userId));
        setSearchQuery('');
        setHasSearched(false);
      } else {
        setFormError(res.error || 'No se pudo enviar la solicitud.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const relationshipLabel = (profile: UserProfile): string | null => {
    const relationship = getRelationshipStatus(profile.userId);
    if (relationship === 'friend') return 'AMIGO';
    if (relationship === 'incoming') return 'RECIBIDA';
    if (relationship === 'outgoing') return 'ENVIADA';
    return null;
  };

  // Confirmación y eliminación de amigo
  const handleRemoveFriend = (friendId: string) => {
    const executeRemove = async () => {
      await removeFriend(friendId);
    };

    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm('¿Seguro que deseas eliminar a este usuario de tus amigos?')) {
        executeRemove();
      }
    } else {
      Alert.alert(
        'Eliminar amigo',
        '¿Deseas remover a este usuario de tu lista de amigos?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: executeRemove },
        ]
      );
    }
  };

  // Generador determinista de color para avatares
  const getColorForId = (id: string): string => {
    const palette = nintendoTheme.colors.avatarColors;
    let hash = 0;
    for (let i = 0; i < id.length; i++) {
      hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
    }
    return palette[hash % palette.length];
  };

  // Formato de fecha
  const formatDate = (isoString: string) => {
    try {
      const d = new Date(isoString);
      return d.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose}>
          <View style={styles.modalBackdrop} />
        </TouchableOpacity>

        <View style={styles.modalCard}>
          {/* Cabecera estilo Nintendo DS Friend Roster */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerIconBox}>
                <Ionicons name="people" size={15} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>RED SOCIAL // AMIGOS</Text>
                <Text style={styles.headerSubtitle}>LISTA DE EXPLORADORES REGISTRADOS</Text>
              </View>
            </View>

            <View style={styles.headerActions}>
              <TouchableOpacity
                style={styles.refreshIconBtn}
                onPress={refreshNetwork}
                disabled={isLoading}
              >
                <Ionicons
                  name="refresh"
                  size={14}
                  color={isLoading ? nintendoTheme.colors.textMuted : nintendoTheme.colors.textPrimary}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={18} color={nintendoTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Selector de Pestañas Principales Bento */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'friends' && styles.tabButtonActive]}
              onPress={() => setActiveTab('friends')}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
                AMIGOS [{friends.length}]
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'requests' && styles.tabButtonActive]}
              onPress={() => setActiveTab('requests')}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
                SOLICITUDES
              </Text>
              {pendingCount > 0 && (
                <View style={styles.tabBadge}>
                  <Text style={styles.tabBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'add' && styles.tabButtonActive]}
              onPress={() => {
                setActiveTab('add');
                setFormError(null);
                setFormSuccess(null);
              }}
              activeOpacity={0.75}
            >
              <Text style={[styles.tabText, activeTab === 'add' && styles.tabTextActive]}>
                + AGREGAR
              </Text>
            </TouchableOpacity>
          </View>

          {/* Contenido de la pestaña: AMIGOS */}
          {activeTab === 'friends' && (
            <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
              {friends.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-outline" size={36} color="#B0B8BF" />
                  <Text style={styles.emptyTitle}>[ LISTA VACÍA ]</Text>
                  <Text style={styles.emptyText}>
                    No tienes amigos agregados aún. Ve a "+ AGREGAR" para conectar con otro explorador.
                  </Text>
                </View>
              ) : (
                friends.map((item) => {
                  const friendId = item.other_user_id || (item.user_a === user?.id ? item.user_b : item.user_a);
                  const avatarColor = item.profile?.color || getColorForId(friendId);
                  const name = profileName(item.profile);
                  const handle = profileHandle(item.profile);
                  return (
                    <View key={item.id} style={styles.friendCard}>
                      <View style={[styles.avatarBox, { borderColor: avatarColor }]}>
                        <View style={[styles.avatarInner, { backgroundColor: avatarColor }]}>
                          <Text style={styles.avatarLetter}>
                            {name.charAt(0).toUpperCase()}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.friendInfo}>
                        <Text style={styles.friendName} numberOfLines={1}>
                          {name}
                        </Text>
                        {handle ? (
                          <Text style={styles.friendHandle} numberOfLines={1}>
                            {handle}
                          </Text>
                        ) : null}
                        <Text style={styles.friendDateText}>
                          DESDE {formatDate(item.updated_at || item.created_at).toUpperCase()}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.removeFriendBtn}
                        onPress={() => handleRemoveFriend(friendId)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="trash-outline" size={13} color={nintendoTheme.colors.famicomRed} />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          )}

          {/* Contenido de la pestaña: SOLICITUDES */}
          {activeTab === 'requests' && (
            <View style={styles.tabContentContainer}>
              <View style={styles.subTabBar}>
                <TouchableOpacity
                  style={[styles.subTabPill, requestSubTab === 'incoming' && styles.subTabPillActive]}
                  onPress={() => setRequestSubTab('incoming')}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      requestSubTab === 'incoming' && styles.subTabTextActive,
                    ]}
                  >
                    RECIBIDAS [{incomingRequests.length}]
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.subTabPill, requestSubTab === 'outgoing' && styles.subTabPillActive]}
                  onPress={() => setRequestSubTab('outgoing')}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      requestSubTab === 'outgoing' && styles.subTabTextActive,
                    ]}
                  >
                    ENVIADAS [{outgoingRequests.length}]
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
                {requestSubTab === 'incoming' ? (
                  incomingRequests.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Ionicons name="mail-outline" size={36} color="#B0B8BF" />
                      <Text style={styles.emptyTitle}>[ BANDEJA VACÍA ]</Text>
                      <Text style={styles.emptyText}>
                        No hay solicitudes entrantes pendientes de aprobación.
                      </Text>
                    </View>
                  ) : (
                    incomingRequests.map((req) => {
                      const requesterId = req.requested_by;
                      const avatarColor = req.profile?.color || getColorForId(requesterId);
                      const name = profileName(req.profile);
                      const handle = profileHandle(req.profile);
                      return (
                        <View key={req.id} style={styles.requestCard}>
                          <View style={styles.requestCardTop}>
                            <View style={[styles.avatarBox, { borderColor: avatarColor }]}>
                              <View style={[styles.avatarInner, { backgroundColor: avatarColor }]}>
                                <Text style={styles.avatarLetter}>
                                  {name.charAt(0).toUpperCase()}
                                </Text>
                              </View>
                            </View>
                            <View style={styles.requestInfo}>
                              <Text style={styles.requestUserText} numberOfLines={1}>
                                {name}
                              </Text>
                              {handle ? (
                                <Text style={styles.requestHandle} numberOfLines={1}>
                                  {handle}
                                </Text>
                              ) : null}
                              <Text style={styles.friendDateText}>
                                {formatDate(req.created_at).toUpperCase()}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.requestActionsRow}>
                            <WiiButton
                              title="RECHAZAR"
                              variant="secondary"
                              size="sm"
                              onPress={() => rejectFriendRequest(req.id)}
                              style={{ flex: 1 }}
                            />
                            <WiiButton
                              title="ACEPTAR"
                              variant="mint"
                              size="sm"
                              icon={<Ionicons name="checkmark" size={13} color="#FFFFFF" />}
                              onPress={() => acceptFriendRequest(req.id)}
                              style={{ flex: 1.2 }}
                            />
                          </View>
                        </View>
                      );
                    })
                  )
                ) : outgoingRequests.length === 0 ? (
                  <View style={styles.emptyContainer}>
                    <Ionicons name="paper-plane-outline" size={36} color="#B0B8BF" />
                    <Text style={styles.emptyTitle}>[ SIN ENVÍOS ACTIVOS ]</Text>
                    <Text style={styles.emptyText}>
                      Aquí verás las solicitudes que hayas enviado a otros exploradores.
                    </Text>
                  </View>
                ) : (
                  outgoingRequests.map((req) => {
                    const recipientId = req.other_user_id || (req.user_a === user?.id ? req.user_b : req.user_a);
                    const avatarColor = req.profile?.color || getColorForId(recipientId);
                    const name = profileName(req.profile);
                    const handle = profileHandle(req.profile);
                    return (
                      <View key={req.id} style={styles.requestCard}>
                        <View style={styles.requestCardTop}>
                          <View style={[styles.avatarBox, { borderColor: avatarColor }]}>
                            <View style={[styles.avatarInner, { backgroundColor: avatarColor }]}>
                              <Text style={styles.avatarLetter}>
                                {name.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                          </View>
                          <View style={styles.requestInfo}>
                            <Text style={styles.requestUserText} numberOfLines={1}>
                              {name}
                            </Text>
                            {handle ? (
                              <Text style={styles.requestHandle} numberOfLines={1}>
                                {handle}
                              </Text>
                            ) : null}
                            <Text style={styles.friendDateText}>
                              ENVIADA: {formatDate(req.created_at).toUpperCase()}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.requestActionsRow}>
                          <WiiButton
                            title="CANCELAR SOLICITUD"
                            variant="secondary"
                            size="sm"
                            onPress={() => cancelFriendRequest(req.id)}
                            style={{ flex: 1 }}
                          />
                        </View>
                      </View>
                    );
                  })
                )}
              </ScrollView>
            </View>
          )}

          {/* Contenido de la pestaña: AGREGAR AMIGO */}
          {activeTab === 'add' && (
            <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
              {/* Tarjeta con el usuario propio */}
              <View style={styles.myIdCard}>
                <View style={styles.myIdHeaderRow}>
                  <Ionicons name="at-outline" size={15} color={nintendoTheme.colors.textPrimary} />
                  <Text style={styles.myIdTitle}>TU NOMBRE DE USUARIO</Text>
                </View>
                <Text style={styles.myIdText} numberOfLines={1} selectable>
                  {user?.username ? `@${user.username}` : 'No disponible'}
                </Text>
                <TouchableOpacity
                  style={styles.copyMyIdBtn}
                  onPress={() => user?.username && handleCopyUsername(user.username)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={copiedNotification ? 'checkmark-circle' : 'copy-outline'}
                    size={13}
                    color={copiedNotification ? '#275E33' : nintendoTheme.colors.textPrimary}
                  />
                  <Text
                    style={[
                      styles.copyMyIdText,
                      copiedNotification && { color: '#275E33' },
                    ]}
                  >
                    {copiedNotification ? '¡USUARIO COPIADO!' : 'COPIAR MI USUARIO'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Búsqueda de exploradores por nombre de usuario */}
              <View style={styles.formContainer}>
                <Text style={styles.formLabel}>
                  BUSCA POR NOMBRE DE USUARIO:
                </Text>

                <View style={styles.inputBox}>
                  <Ionicons name="search-outline" size={15} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="ej. ExploradorGeo"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={searchQuery}
                    onChangeText={(val) => {
                      setSearchQuery(val);
                      setFormError(null);
                      setFormSuccess(null);
                      setHasSearched(false);
                    }}
                    onSubmitEditing={handleSearch}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {searchQuery.length > 0 && (
                    <TouchableOpacity
                      onPress={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        setHasSearched(false);
                      }}
                      style={{ padding: 2 }}
                    >
                      <Ionicons name="close-circle" size={14} color={nintendoTheme.colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {formError ? (
                  <View style={styles.errorBox}>
                    <Ionicons name="alert-circle-outline" size={13} color={nintendoTheme.colors.famicomRed} />
                    <Text style={styles.errorText}>{formError}</Text>
                  </View>
                ) : null}

                {formSuccess ? (
                  <View style={styles.successBox}>
                    <Ionicons name="checkmark-circle-outline" size={13} color="#275E33" />
                    <Text style={styles.successText}>{formSuccess}</Text>
                  </View>
                ) : null}

                <WiiButton
                  title={isSearching ? 'BUSCANDO...' : 'BUSCAR EXPLORADOR'}
                  variant="mint"
                  size="md"
                  disabled={searchQuery.trim().length < 2 || isSearching}
                  icon={<Ionicons name="search" size={13} color="#FFFFFF" />}
                  onPress={handleSearch}
                  style={{ marginTop: 12 }}
                />
              </View>

              {searchResults.length > 0 ? (
                <View style={styles.searchResults}>
                  {searchResults.map((profile) => {
                    const relationship = relationshipLabel(profile);
                    const avatarColor = profile.color || getColorForId(profile.userId);
                    return (
                      <View key={profile.userId} style={styles.searchResultCard}>
                        <View style={[styles.avatarBox, { borderColor: avatarColor }]}>
                          <View style={[styles.avatarInner, { backgroundColor: avatarColor }]}>
                            <Text style={styles.avatarLetter}>
                              {profileName(profile).charAt(0).toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <View style={styles.friendInfo}>
                          <Text style={styles.friendName} numberOfLines={1}>
                            {profileName(profile)}
                          </Text>
                          <Text style={styles.friendHandle} numberOfLines={1}>
                            {profileHandle(profile)}
                          </Text>
                        </View>
                        <WiiButton
                          title={relationship ?? (isSubmitting ? 'ENVIANDO...' : 'AGREGAR')}
                          variant={relationship ? 'secondary' : 'mint'}
                          size="sm"
                          disabled={!!relationship || isSubmitting}
                          onPress={() => handleSendRequest(profile)}
                        />
                      </View>
                    );
                  })}
                </View>
              ) : hasSearched && !isSearching && !formError ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="search-outline" size={30} color="#B0B8BF" />
                  <Text style={styles.emptyTitle}>[ SIN RESULTADOS ]</Text>
                  <Text style={styles.emptyText}>
                    No encontramos exploradores con ese nombre de usuario.
                  </Text>
                </View>
              ) : null}
            </ScrollView>
          )}
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
    maxHeight: '85%',
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
    borderRadius: 2,
    backgroundColor: nintendoTheme.colors.retroDpad,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
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
  refreshIconBtn: {
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
    marginBottom: 6,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    borderRadius: 2,
    gap: 4,
    position: 'relative',
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBC7BD',
  },
  tabText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  tabTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '800',
  },
  tabBadge: {
    backgroundColor: nintendoTheme.colors.famicomRed,
    borderRadius: 6,
    paddingHorizontal: 4,
    paddingVertical: 1,
    minWidth: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  tabContentContainer: {
    flex: 1,
  },
  subTabBar: {
    flexDirection: 'row',
    gap: 6,
    marginVertical: 6,
  },
  subTabPill: {
    flex: 1,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#D4D0C6',
    alignItems: 'center',
  },
  subTabPillActive: {
    backgroundColor: nintendoTheme.colors.retroDpad,
    borderColor: '#111315',
  },
  subTabText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  subTabTextActive: {
    color: '#FFFFFF',
  },
  scrollList: {
    maxHeight: 320,
    marginTop: 4,
  },
  listContent: {
    paddingVertical: 4,
    gap: 8,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 8,
    gap: 8,
  },
  avatarBox: {
    width: 26,
    height: 26,
    borderRadius: 2,
    borderWidth: 1,
    padding: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  friendInfo: {
    flex: 1,
  },
  friendName: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  friendHandle: {
    fontSize: 9,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 1,
  },
  friendDateText: {
    fontSize: 8,
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
  removeFriendBtn: {
    padding: 6,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  requestCard: {
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 10,
    gap: 8,
  },
  requestCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  requestInfo: {
    flex: 1,
  },
  requestUserText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  requestHandle: {
    fontSize: 9,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 1,
  },
  requestActionsRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  searchResults: {
    gap: 8,
    marginTop: 8,
  },
  searchResultCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 8,
    gap: 8,
  },
  myIdCard: {
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    padding: 10,
    marginBottom: 8,
  },
  myIdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  myIdTitle: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  myIdText: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#E2DFD8',
    marginTop: 4,
  },
  copyMyIdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  copyMyIdText: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 12,
  },
  formLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 6,
    letterSpacing: 0.4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#D4D0C6',
    paddingHorizontal: 10,
    height: 38,
    gap: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 11,
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    padding: 6,
    borderRadius: 2,
    marginTop: 6,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  errorText: {
    color: nintendoTheme.colors.famicomRed,
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EDF5EE',
    padding: 6,
    borderRadius: 2,
    marginTop: 6,
    borderWidth: 1,
    borderColor: '#C2DEC5',
  },
  successText: {
    color: '#275E33',
    fontSize: 10,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
    paddingHorizontal: 12,
  },
  emptyTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  emptyText: {
    fontSize: 10,
    color: nintendoTheme.colors.textMuted,
    textAlign: 'center',
    marginTop: 2,
    lineHeight: 14,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
