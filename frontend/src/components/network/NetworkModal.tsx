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
import { validateRecipientId } from '../../utils/validators';
import { API_CONFIG } from '../../config/api.config';

interface NetworkModalProps {
  visible: boolean;
  onClose: () => void;
  initialRecipientId?: string;
}

type TabType = 'friends' | 'requests' | 'add';
type RequestSubTab = 'incoming' | 'outgoing';

export const NetworkModal: React.FC<NetworkModalProps> = ({
  visible,
  onClose,
  initialRecipientId = '',
}) => {
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
    isLoading,
  } = useNetwork();

  const [activeTab, setActiveTab] = useState<TabType>('friends');
  const [requestSubTab, setRequestSubTab] = useState<RequestSubTab>('incoming');

  // Estado del formulario de agregar amigo
  const [targetIdInput, setTargetIdInput] = useState(initialRecipientId);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);

  // Copiar ID al portapapeles
  const handleCopyId = (idToCopy: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        navigator.clipboard.writeText(idToCopy);
      }
      setCopiedNotification(true);
      setTimeout(() => setCopiedNotification(false), 2500);
    } catch {
      // Fallback
      Alert.alert('ID Copiado', idToCopy);
    }
  };

  // Manejo de envío de solicitud
  const handleSendRequest = async () => {
    setFormError(null);
    setFormSuccess(null);

    const validation = validateRecipientId(targetIdInput, user?.id, API_CONFIG.USE_MOCKS);
    if (!validation.isValid) {
      setFormError(validation.error || 'ID inválido.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await sendFriendRequest(targetIdInput.trim());
      if (res.success) {
        setFormSuccess('¡Solicitud de amistad enviada con éxito!');
        setTargetIdInput('');
      } else {
        setFormError(res.error || 'No se pudo enviar la solicitud.');
      }
    } finally {
      setIsSubmitting(false);
    }
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
          {/* Cabecera estilo Nintendo Wii */}
          <View style={styles.header}>
            <View style={styles.headerTitleGroup}>
              <View style={styles.headerIconCircle}>
                <Ionicons name="people" size={18} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Red de Amigos</Text>
                <Text style={styles.headerSubtitle}>Conexiones Sociales GeoPicto</Text>
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
                  size={16}
                  color={isLoading ? nintendoTheme.colors.textMuted : nintendoTheme.colors.wiiBlue}
                />
              </TouchableOpacity>
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color={nintendoTheme.colors.textSecondary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Selector de Pestañas Principales */}
          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'friends' && styles.tabButtonActive]}
              onPress={() => setActiveTab('friends')}
            >
              <Ionicons
                name="people-outline"
                size={16}
                color={activeTab === 'friends' ? nintendoTheme.colors.wiiBlue : nintendoTheme.colors.textSecondary}
              />
              <Text style={[styles.tabText, activeTab === 'friends' && styles.tabTextActive]}>
                Amigos ({friends.length})
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabButton, activeTab === 'requests' && styles.tabButtonActive]}
              onPress={() => setActiveTab('requests')}
            >
              <Ionicons
                name="mail-outline"
                size={16}
                color={activeTab === 'requests' ? nintendoTheme.colors.wiiBlue : nintendoTheme.colors.textSecondary}
              />
              <Text style={[styles.tabText, activeTab === 'requests' && styles.tabTextActive]}>
                Solicitudes
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
            >
              <Ionicons
                name="person-add-outline"
                size={16}
                color={activeTab === 'add' ? nintendoTheme.colors.miiverseGreen : nintendoTheme.colors.textSecondary}
              />
              <Text style={[styles.tabText, activeTab === 'add' && styles.tabTextActive]}>
                Agregar
              </Text>
            </TouchableOpacity>
          </View>

          {/* Contenido de la pestaña: AMIGOS */}
          {activeTab === 'friends' && (
            <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
              {friends.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Ionicons name="people-circle-outline" size={48} color="#CBD5E1" />
                  <Text style={styles.emptyTitle}>Sin amigos agregados</Text>
                  <Text style={styles.emptyText}>
                    Ve a la pestaña "Agregar" para enviar una solicitud ingresando el ID de otro usuario, o
                    comparte tu propio ID.
                  </Text>
                </View>
              ) : (
                friends.map((item) => {
                  const friendId = item.other_user_id || (item.user_a === user?.id ? item.user_b : item.user_a);
                  const avatarColor = getColorForId(friendId);
                  return (
                    <View key={item.id} style={styles.friendCard}>
                      <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                        <Text style={styles.avatarLetter}>
                          {friendId.charAt(0).toUpperCase()}
                        </Text>
                      </View>

                      <View style={styles.friendInfo}>
                        <View style={styles.friendIdRow}>
                          <Text style={styles.friendIdLabel} numberOfLines={1}>
                            ID: {friendId}
                          </Text>
                          <TouchableOpacity
                            onPress={() => handleCopyId(friendId)}
                            style={styles.copySmallBtn}
                          >
                            <Ionicons name="copy-outline" size={12} color={nintendoTheme.colors.wiiBlue} />
                          </TouchableOpacity>
                        </View>
                        <Text style={styles.friendDateText}>
                          Amigos desde {formatDate(item.updated_at || item.created_at)}
                        </Text>
                      </View>

                      <TouchableOpacity
                        style={styles.removeFriendBtn}
                        onPress={() => handleRemoveFriend(friendId)}
                        activeOpacity={0.7}
                      >
                        <Ionicons name="person-remove-outline" size={16} color="#DC2626" />
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
              {/* Sub-pestañas: Recibidas / Enviadas */}
              <View style={styles.subTabBar}>
                <TouchableOpacity
                  style={[styles.subTabPill, requestSubTab === 'incoming' && styles.subTabPillActive]}
                  onPress={() => setRequestSubTab('incoming')}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      requestSubTab === 'incoming' && styles.subTabTextActive,
                    ]}
                  >
                    Recibidas ({incomingRequests.length})
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.subTabPill, requestSubTab === 'outgoing' && styles.subTabPillActive]}
                  onPress={() => setRequestSubTab('outgoing')}
                >
                  <Text
                    style={[
                      styles.subTabText,
                      requestSubTab === 'outgoing' && styles.subTabTextActive,
                    ]}
                  >
                    Enviadas ({outgoingRequests.length})
                  </Text>
                </TouchableOpacity>
              </View>

              <ScrollView style={styles.scrollList} contentContainerStyle={styles.listContent}>
                {requestSubTab === 'incoming' ? (
                  incomingRequests.length === 0 ? (
                    <View style={styles.emptyContainer}>
                      <Ionicons name="mail-open-outline" size={44} color="#CBD5E1" />
                      <Text style={styles.emptyTitle}>No tienes solicitudes pendientes</Text>
                      <Text style={styles.emptyText}>
                        Cuando otros usuarios te agreguen con tu ID, las verás aquí para aceptarlas.
                      </Text>
                    </View>
                  ) : (
                    incomingRequests.map((req) => {
                      const requesterId = req.requested_by;
                      const avatarColor = getColorForId(requesterId);
                      return (
                        <View key={req.id} style={styles.requestCard}>
                          <View style={styles.requestCardTop}>
                            <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                              <Text style={styles.avatarLetter}>
                                {requesterId.charAt(0).toUpperCase()}
                              </Text>
                            </View>
                            <View style={styles.requestInfo}>
                              <Text style={styles.requestUserText} numberOfLines={1}>
                                De: {requesterId}
                              </Text>
                              <Text style={styles.friendDateText}>
                                {formatDate(req.created_at)}
                              </Text>
                            </View>
                          </View>

                          <View style={styles.requestActionsRow}>
                            <WiiButton
                              title="Rechazar"
                              variant="secondary"
                              size="sm"
                              onPress={() => rejectFriendRequest(req.id)}
                              style={{ flex: 1 }}
                            />
                            <WiiButton
                              title="Aceptar"
                              variant="mint"
                              size="sm"
                              icon={<Ionicons name="checkmark" size={14} color="#FFFFFF" />}
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
                    <Ionicons name="paper-plane-outline" size={44} color="#CBD5E1" />
                    <Text style={styles.emptyTitle}>No hay solicitudes enviadas</Text>
                    <Text style={styles.emptyText}>
                      Aquí aparecerán las solicitudes pendientes que hayas enviado a otros usuarios.
                    </Text>
                  </View>
                ) : (
                  outgoingRequests.map((req) => {
                    const recipientId = req.other_user_id || (req.user_a === user?.id ? req.user_b : req.user_a);
                    const avatarColor = getColorForId(recipientId);
                    return (
                      <View key={req.id} style={styles.requestCard}>
                        <View style={styles.requestCardTop}>
                          <View style={[styles.avatarCircle, { backgroundColor: avatarColor }]}>
                            <Text style={styles.avatarLetter}>
                              {recipientId.charAt(0).toUpperCase()}
                            </Text>
                          </View>
                          <View style={styles.requestInfo}>
                            <Text style={styles.requestUserText} numberOfLines={1}>
                              Para: {recipientId}
                            </Text>
                            <Text style={styles.friendDateText}>
                              Enviada el {formatDate(req.created_at)}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.requestActionsRow}>
                          <WiiButton
                            title="Cancelar Solicitud"
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
              {/* Tarjeta con ID propio del usuario */}
              <View style={styles.myIdCard}>
                <View style={styles.myIdHeaderRow}>
                  <Ionicons name="finger-print-outline" size={18} color={nintendoTheme.colors.wiiBlue} />
                  <Text style={styles.myIdTitle}>Tu ID de Explorador</Text>
                </View>
                <Text style={styles.myIdText} numberOfLines={1} selectable>
                  {user?.id || 'No disponible'}
                </Text>
                <TouchableOpacity
                  style={styles.copyMyIdBtn}
                  onPress={() => user?.id && handleCopyId(user.id)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name={copiedNotification ? 'checkmark-circle' : 'copy-outline'}
                    size={15}
                    color={copiedNotification ? '#15803D' : nintendoTheme.colors.wiiBlue}
                  />
                  <Text
                    style={[
                      styles.copyMyIdText,
                      copiedNotification && { color: '#15803D', fontWeight: '700' },
                    ]}
                  >
                    {copiedNotification ? '¡ID Copiado al portapapeles!' : 'Copiar mi ID para compartir'}
                  </Text>
                </TouchableOpacity>
              </View>

              {/* Formulario de envío de solicitud */}
              <View style={styles.formContainer}>
                <Text style={styles.formLabel}>
                  Ingresa el ID del usuario al que deseas agregar:
                </Text>

                <View style={styles.inputBox}>
                  <Ionicons name="person-add-outline" size={18} color={nintendoTheme.colors.textSecondary} />
                  <TextInput
                    style={styles.textInput}
                    placeholder="Ej: 123e4567-e89b-12d3-a456-426614174000"
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    value={targetIdInput}
                    onChangeText={(val) => {
                      setTargetIdInput(val);
                      setFormError(null);
                      setFormSuccess(null);
                    }}
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  {targetIdInput.length > 0 && (
                    <TouchableOpacity onPress={() => setTargetIdInput('')} style={{ padding: 4 }}>
                      <Ionicons name="close-circle" size={16} color={nintendoTheme.colors.textMuted} />
                    </TouchableOpacity>
                  )}
                </View>

                {formError ? <Text style={styles.errorText}>{formError}</Text> : null}
                {formSuccess ? <Text style={styles.successText}>{formSuccess}</Text> : null}

                <WiiButton
                  title={isSubmitting ? 'Enviando Solicitud...' : 'Enviar Solicitud de Amistad'}
                  variant="mint"
                  size="md"
                  disabled={!targetIdInput.trim() || isSubmitting}
                  icon={<Ionicons name="send" size={15} color="#FFFFFF" />}
                  onPress={handleSendRequest}
                  style={{ marginTop: 14 }}
                />
              </View>
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
    backgroundColor: 'rgba(28, 40, 36, 0.45)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.lg,
    borderWidth: 2,
    borderColor: '#384347',
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: '#EEF2F0',
  },
  headerTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: nintendoTheme.colors.wiiBlue,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 3,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  headerSubtitle: {
    fontSize: 11,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  refreshIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EBF6FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtn: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#F0F4F3',
  },
  tabBar: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F4',
    borderRadius: nintendoTheme.borderRadius.pill,
    padding: 3,
    marginTop: 12,
    marginBottom: 8,
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 7,
    borderRadius: nintendoTheme.borderRadius.pill,
    gap: 6,
    position: 'relative',
  },
  tabButtonActive: {
    backgroundColor: '#FFFFFF',
    ...nintendoTheme.shadows.wiiSoft,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
  },
  tabTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '700',
  },
  tabBadge: {
    backgroundColor: '#EF4444',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 1,
    minWidth: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabBadgeText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
  },
  tabContentContainer: {
    flex: 1,
  },
  subTabBar: {
    flexDirection: 'row',
    gap: 8,
    marginVertical: 8,
  },
  subTabPill: {
    flex: 1,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: nintendoTheme.borderRadius.pill,
    backgroundColor: '#FAFDFB',
    borderWidth: 1,
    borderColor: '#D4E0DC',
    alignItems: 'center',
  },
  subTabPillActive: {
    backgroundColor: '#EBF6FC',
    borderColor: '#BAE3F7',
  },
  subTabText: {
    fontSize: 12,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '600',
  },
  subTabTextActive: {
    color: nintendoTheme.colors.wiiBlue,
    fontWeight: '700',
  },
  scrollList: {
    maxHeight: 340,
    marginTop: 6,
  },
  listContent: {
    paddingVertical: 6,
    gap: 10,
  },
  friendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#DFE8E4',
    padding: 10,
    gap: 10,
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarLetter: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  friendInfo: {
    flex: 1,
  },
  friendIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  friendIdLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    maxWidth: 220,
  },
  copySmallBtn: {
    padding: 2,
  },
  friendDateText: {
    fontSize: 11,
    color: nintendoTheme.colors.textMuted,
    marginTop: 2,
  },
  removeFriendBtn: {
    padding: 6,
    borderRadius: 16,
    backgroundColor: '#FEE2E2',
  },
  requestCard: {
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#DDE6E2',
    padding: 12,
    gap: 10,
  },
  requestCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  requestInfo: {
    flex: 1,
  },
  requestUserText: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  requestActionsRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  myIdCard: {
    backgroundColor: '#F0F9FF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#BAE6FD',
    padding: 12,
    marginBottom: 10,
  },
  myIdHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  myIdTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.wiiBlue,
  },
  myIdText: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E0F2FE',
    marginTop: 4,
  },
  copyMyIdBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  copyMyIdText: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.wiiBlue,
  },
  formContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#DFE8E4',
    padding: 14,
  },
  formLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    marginBottom: 8,
    lineHeight: 16,
  },
  inputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#D4DFDB',
    paddingHorizontal: 12,
    height: 44,
    gap: 8,
  },
  textInput: {
    flex: 1,
    fontSize: 13,
    color: nintendoTheme.colors.textPrimary,
  },
  errorText: {
    color: '#DC2626',
    fontSize: 11,
    fontWeight: '600',
    marginTop: 8,
  },
  successText: {
    color: '#15803D',
    fontSize: 11,
    fontWeight: '700',
    marginTop: 8,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 28,
    paddingHorizontal: 16,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    marginTop: 8,
  },
  emptyText: {
    fontSize: 12,
    color: nintendoTheme.colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    lineHeight: 16,
  },
});
