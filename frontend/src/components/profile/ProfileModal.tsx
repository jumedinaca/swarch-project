import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { UserProfile, UserReputation } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useProfile } from '../../context/ProfileContext';
import { useNetwork } from '../../context/NetworkContext';
import { profileService, colorForUserId } from '../../services/profile/profileService';
import { reputationService } from '../../services/reputation/reputationService';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';

interface ProfileModalProps {
  visible: boolean;
  onClose: () => void;
  /** Si se omite o coincide con el usuario actual, abre el editor de perfil propio */
  targetUserId?: string | null;
  onOpenReputationModal?: () => void;
}

const COLOR_SWATCHES = [
  '#B52B32',
  '#2A5D84',
  '#2D6A4F',
  '#8A5A00',
  '#5E4378',
  '#2E6F68',
  '#2AC769',
  '#1EA4E8',
  '#FF7A2F',
  '#E84393',
];

const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

export const ProfileModal: React.FC<ProfileModalProps> = ({
  visible,
  onClose,
  targetUserId,
  onOpenReputationModal,
}) => {
  const { user } = useAuth();
  const {
    myProfile,
    myReputation,
    updateMyProfile,
    uploadMyAvatar,
    deleteMyAvatar,
    refreshMyProfile,
    refreshMyReputation,
  } = useProfile();
  const {
    getRelationshipStatus,
    sendFriendRequest,
    incomingRequests,
    acceptFriendRequest,
  } = useNetwork();

  const effectiveUserId = targetUserId || user?.id || '';
  const isMe = !targetUserId || (!!user?.id && targetUserId === user.id);

  // Estado local para edición de perfil propio
  const [displayName, setDisplayName] = useState('');
  const [about, setAbout] = useState('');
  const [selectedColor, setSelectedColor] = useState('#2D6A4F');
  const [customHex, setCustomHex] = useState('#2D6A4F');

  // Estado para perfil y reputación de otro usuario
  const [externalProfile, setExternalProfile] = useState<UserProfile | null>(null);
  const [externalReputation, setExternalReputation] = useState<UserReputation | null>(null);
  const [isLoadingExternal, setIsLoadingExternal] = useState(false);

  const [isSaving, setIsSaving] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  // Sincronizar campos al abrir el modal
  useEffect(() => {
    if (!visible) return;
    setFeedback(null);

    if (isMe) {
      refreshMyProfile();
      refreshMyReputation();
    } else if (effectiveUserId) {
      setIsLoadingExternal(true);
      Promise.all([
        profileService.getById(effectiveUserId).catch(() => null),
        reputationService.getByUserId(effectiveUserId).catch(() => null),
      ])
        .then(([prof, rep]) => {
          setExternalProfile(prof);
          setExternalReputation(rep);
        })
        .finally(() => {
          setIsLoadingExternal(false);
        });
    }
  }, [visible, isMe, effectiveUserId, refreshMyProfile, refreshMyReputation]);

  useEffect(() => {
    if (isMe && myProfile) {
      setDisplayName(myProfile.displayName || myProfile.username || '');
      setAbout(myProfile.about || '');
      const col = myProfile.color || colorForUserId(myProfile.userId);
      setSelectedColor(col);
      setCustomHex(col);
    }
  }, [isMe, myProfile]);

  const activeProfile: UserProfile | null = isMe ? myProfile : externalProfile;
  const activeReputation: UserReputation | null = isMe ? myReputation : externalReputation;

  const shownColor = isMe
    ? selectedColor
    : activeProfile?.color || colorForUserId(effectiveUserId);
  const shownName = isMe
    ? displayName.trim() || user?.username || 'Explorador'
    : activeProfile?.displayName ||
      activeProfile?.username ||
      `Explorador ${effectiveUserId.slice(0, 4)}`;
  const shownUsername = activeProfile?.username || (isMe ? user?.username : effectiveUserId.slice(0, 8));
  const shownAvatarUrl = activeProfile?.avatarUrl || null;

  const handleSelectSwatch = (color: string) => {
    setSelectedColor(color.toUpperCase());
    setCustomHex(color.toUpperCase());
    setFeedback(null);
  };

  const handleHexChange = (val: string) => {
    setCustomHex(val);
    if (HEX_COLOR_REGEX.test(val.trim())) {
      setSelectedColor(val.trim().toUpperCase());
    }
  };

  const handleSaveProfile = async () => {
    setFeedback(null);
    const trimmedName = displayName.trim();
    if (trimmedName.length > 50) {
      setFeedback({
        text: 'El nombre visible debe tener máximo 50 caracteres.',
        isError: true,
      });
      return;
    }
    if (about.length > 500) {
      setFeedback({
        text: 'La biografía no puede superar los 500 caracteres.',
        isError: true,
      });
      return;
    }
    const finalColor = HEX_COLOR_REGEX.test(customHex.trim())
      ? customHex.trim().toUpperCase()
      : selectedColor;

    setIsSaving(true);
    try {
      const res = await updateMyProfile({
        displayName: trimmedName.length > 0 ? trimmedName : null,
        about: about.trim().length > 0 ? about.trim() : null,
        color: finalColor,
      });
      if (res.success) {
        setFeedback({ text: '¡Perfil actualizado correctamente!', isError: false });
      } else {
        setFeedback({
          text: res.error || 'No se pudo guardar el perfil.',
          isError: true,
        });
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handlePickAvatarFile = () => {
    setFeedback(null);
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp';
      input.onchange = async (ev: any) => {
        const file: File | undefined = ev?.target?.files?.[0];
        if (!file) return;
        setIsUploadingAvatar(true);
        try {
          const res = await uploadMyAvatar(file);
          if (res.success) {
            setFeedback({ text: '¡Avatar actualizado!', isError: false });
          } else {
            setFeedback({
              text: res.error || 'No se pudo subir la imagen.',
              isError: true,
            });
          }
        } finally {
          setIsUploadingAvatar(false);
        }
      };
      input.click();
    } else {
      setFeedback({
        text: 'La subida de archivo desde selector está habilitada en versión Web.',
        isError: true,
      });
    }
  };

  const handleDeleteAvatar = async () => {
    setFeedback(null);
    setIsUploadingAvatar(true);
    try {
      const res = await deleteMyAvatar();
      if (res.success) {
        setFeedback({ text: 'Avatar eliminado.', isError: false });
      } else {
        setFeedback({
          text: res.error || 'No se pudo eliminar el avatar.',
          isError: true,
        });
      }
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const relationship = isMe ? 'self' : getRelationshipStatus(effectiveUserId);

  const handleFriendAction = async () => {
    setFeedback(null);
    if (relationship === 'none') {
      const res = await sendFriendRequest(effectiveUserId);
      setFeedback({
        text: res.success
          ? '¡Solicitud de amistad enviada!'
          : res.error || 'Error al enviar solicitud.',
        isError: !res.success,
      });
    } else if (relationship === 'incoming') {
      const req = incomingRequests.find(
        (r) => r.requested_by === effectiveUserId || r.other_user_id === effectiveUserId
      );
      if (req) {
        const res = await acceptFriendRequest(req.id);
        setFeedback({
          text: res.success ? '¡Ahora son amigos!' : res.error || 'Error al aceptar.',
          isError: !res.success,
        });
      }
    }
  };

  const progressPercent = Math.max(
    0,
    Math.min(100, Math.round((activeReputation?.progress ?? 0) * 100))
  );

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
              <View style={[styles.headerIconBox, { backgroundColor: shownColor }]}>
                <Ionicons name="person" size={14} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>
                  {isMe ? 'MI PERFIL DE EXPLORADOR' : 'PERFIL DE EXPLORADOR'}
                </Text>
                <Text style={styles.headerSubtitle}>
                  {isMe
                    ? 'IDENTIDAD PÚBLICA, AVATAR Y REPUTACIÓN'
                    : `ID: ${effectiveUserId.slice(0, 16)}...`}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {isLoadingExternal && !isMe ? (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="small" color={nintendoTheme.colors.retroDpad} />
              <Text style={styles.loadingText}>CARGANDO PERFIL DEL EXPLORADOR...</Text>
            </View>
          ) : (
            <ScrollView
              style={styles.scrollArea}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Tarjeta superior de Avatar + Identidad */}
              <View style={styles.identityBanner}>
                <View style={[styles.avatarFrame, { borderColor: shownColor }]}>
                  {shownAvatarUrl ? (
                    <Image source={{ uri: shownAvatarUrl }} style={styles.avatarImage} />
                  ) : (
                    <View style={[styles.avatarFallback, { backgroundColor: shownColor }]}>
                      <Text style={styles.avatarFallbackLetter}>
                        {shownName.charAt(0).toUpperCase()}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.identityTextCol}>
                  <Text style={styles.identityDisplayName} numberOfLines={1}>
                    {shownName}
                  </Text>
                  <Text style={styles.identityUsername} numberOfLines={1}>
                    @{shownUsername}
                  </Text>

                  {isMe && (
                    <View style={styles.avatarButtonsRow}>
                      <TouchableOpacity
                        style={styles.avatarActionBtn}
                        onPress={handlePickAvatarFile}
                        disabled={isUploadingAvatar}
                        activeOpacity={0.75}
                      >
                        <Ionicons
                          name="camera-outline"
                          size={12}
                          color={nintendoTheme.colors.textPrimary}
                        />
                        <Text style={styles.avatarActionText}>
                          {isUploadingAvatar ? 'SUBIENDO...' : 'SUBIR AVATAR'}
                        </Text>
                      </TouchableOpacity>

                      {shownAvatarUrl && (
                        <TouchableOpacity
                          style={[styles.avatarActionBtn, styles.avatarDeleteBtn]}
                          onPress={handleDeleteAvatar}
                          disabled={isUploadingAvatar}
                          activeOpacity={0.75}
                        >
                          <Ionicons
                            name="trash-outline"
                            size={12}
                            color={nintendoTheme.colors.famicomRed}
                          />
                          <Text style={styles.avatarDeleteText}>QUITAR</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  )}
                </View>
              </View>

              {/* Tarjeta de Reputación del Explorador */}
              <View style={styles.reputationCard}>
                <View style={styles.repHeaderRow}>
                  <View style={styles.repBadgePill}>
                    <Ionicons name="trophy" size={12} color="#8A5A00" />
                    <Text style={styles.repBadgeLevel}>
                      NIVEL: {(activeReputation?.level || 'Novato').toUpperCase()}
                    </Text>
                  </View>
                  <Text style={styles.repScoreText}>
                    {activeReputation?.score ?? 0} / 1000 PTS
                  </Text>
                </View>

                <View style={styles.progressBarTrack}>
                  <View
                    style={[
                      styles.progressBarFill,
                      {
                        width: `${progressPercent}%`,
                        backgroundColor: shownColor,
                      },
                    ]}
                  />
                </View>

                <View style={styles.repMetaRow}>
                  <Text style={styles.repNextText}>
                    {activeReputation?.nextLevelAt
                      ? `PROGRESO AL SIGUIENTE NIVEL: ${progressPercent}% (META: ${activeReputation.nextLevelAt} PTS)`
                      : '¡NIVEL MÁXIMO ALCANZADO (LEYENDA)!'}
                  </Text>
                </View>

                <View style={styles.repCountersRow}>
                  <View style={styles.repStatBox}>
                    <Text style={styles.repStatValue}>
                      👍 {activeReputation?.likesReceived ?? 0}
                    </Text>
                    <Text style={styles.repStatLabel}>LIKES</Text>
                  </View>
                  <View style={styles.repStatBox}>
                    <Text style={styles.repStatValue}>
                      👎 {activeReputation?.dislikesReceived ?? 0}
                    </Text>
                    <Text style={styles.repStatLabel}>DISLIKES</Text>
                  </View>
                  <View style={styles.repStatBox}>
                    <Text style={styles.repStatValue}>
                      ⚠️ {activeReputation?.messagesWarned ?? 0}
                    </Text>
                    <Text style={styles.repStatLabel}>ADVERTENCIAS</Text>
                  </View>
                  <View style={styles.repStatBox}>
                    <Text style={styles.repStatValue}>
                      🚫 {activeReputation?.messagesBlocked ?? 0}
                    </Text>
                    <Text style={styles.repStatLabel}>BLOQUEOS</Text>
                  </View>
                </View>

                {isMe && onOpenReputationModal && (
                  <TouchableOpacity
                    style={styles.openRepModalBtn}
                    onPress={() => {
                      onClose();
                      onOpenReputationModal();
                    }}
                    activeOpacity={0.75}
                  >
                    <Ionicons
                      name="podium-outline"
                      size={13}
                      color={nintendoTheme.colors.wiiBlue}
                    />
                    <Text style={styles.openRepModalText}>
                      VER TABLA DE LÍDERES E HISTORIAL DE PUNTOS
                    </Text>
                    <Ionicons
                      name="chevron-forward"
                      size={13}
                      color={nintendoTheme.colors.wiiBlue}
                    />
                  </TouchableOpacity>
                )}
              </View>

              {/* Modo edición (Mi Perfil) vs Modo lectura (Otro Explorador) */}
              {isMe ? (
                <View style={styles.formSection}>
                  <Text style={styles.fieldLabel}>NOMBRE VISIBLE (1–50 CARACTERES)</Text>
                  <TextInput
                    style={styles.textInput}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder={user?.username || 'Tu nombre visible'}
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    maxLength={50}
                  />

                  <View style={styles.labelWithCounter}>
                    <Text style={styles.fieldLabel}>ACERCA DE MÍ / BIOGRAFÍA</Text>
                    <Text style={styles.counterSmall}>[{about.length}/500]</Text>
                  </View>
                  <TextInput
                    style={[styles.textInput, styles.textArea]}
                    value={about}
                    onChangeText={setAbout}
                    placeholder="Cuéntale a otros exploradores qué sueles publicar en el mapa..."
                    placeholderTextColor={nintendoTheme.colors.textMuted}
                    multiline
                    maxLength={500}
                    textAlignVertical="top"
                  />

                  <Text style={styles.fieldLabel}>COLOR DISTINTIVO DE AUTOR</Text>
                  <View style={styles.swatchesRow}>
                    {COLOR_SWATCHES.map((swatch) => {
                      const isSelected =
                        selectedColor.toUpperCase() === swatch.toUpperCase();
                      return (
                        <TouchableOpacity
                          key={swatch}
                          style={[
                            styles.swatchCircle,
                            { backgroundColor: swatch },
                            isSelected && styles.swatchSelected,
                          ]}
                          onPress={() => handleSelectSwatch(swatch)}
                          activeOpacity={0.8}
                        >
                          {isSelected && (
                            <Ionicons name="checkmark" size={13} color="#FFFFFF" />
                          )}
                        </TouchableOpacity>
                      );
                    })}
                  </View>

                  <View style={styles.customHexRow}>
                    <Text style={styles.customHexLabel}>CÓDIGO HEX (#RRGGBB):</Text>
                    <TextInput
                      style={styles.hexInput}
                      value={customHex}
                      onChangeText={handleHexChange}
                      maxLength={7}
                      autoCapitalize="characters"
                    />
                    <View
                      style={[
                        styles.hexPreview,
                        { backgroundColor: shownColor },
                      ]}
                    />
                  </View>
                </View>
              ) : (
                <View style={styles.publicBioSection}>
                  <Text style={styles.fieldLabel}>ACERCA DE ESTE EXPLORADOR</Text>
                  <View style={styles.bioReadBox}>
                    <Text style={styles.bioReadText}>
                      {activeProfile?.about ||
                        'Este explorador aún no ha escrito una descripción pública.'}
                    </Text>
                  </View>

                  <View style={styles.friendActionWrap}>
                    {relationship === 'friend' && (
                      <View style={styles.friendStatusTag}>
                        <Ionicons
                          name="checkmark-circle"
                          size={14}
                          color="#275E33"
                        />
                        <Text style={styles.friendStatusText}>
                          YA SON AMIGOS EN TU RED SOCIAL
                        </Text>
                      </View>
                    )}
                    {relationship === 'outgoing' && (
                      <View style={styles.pendingStatusTag}>
                        <Ionicons name="time-outline" size={14} color="#8A5A00" />
                        <Text style={styles.pendingStatusText}>
                          SOLICITUD DE AMISTAD ENVIADA
                        </Text>
                      </View>
                    )}
                    {(relationship === 'none' || relationship === 'incoming') && (
                      <WiiButton
                        title={
                          relationship === 'incoming'
                            ? 'ACEPTAR SOLICITUD DE AMISTAD'
                            : 'AGREGAR A MI RED DE AMIGOS'
                        }
                        variant="mint"
                        size="sm"
                        icon={
                          <Ionicons
                            name="person-add-outline"
                            size={13}
                            color="#FFFFFF"
                          />
                        }
                        onPress={handleFriendAction}
                      />
                    )}
                  </View>
                </View>
              )}

              {feedback && (
                <View
                  style={[
                    styles.feedbackBanner,
                    feedback.isError ? styles.feedbackErrorBox : styles.feedbackOkBox,
                  ]}
                >
                  <Ionicons
                    name={
                      feedback.isError
                        ? 'alert-circle-outline'
                        : 'checkmark-circle-outline'
                    }
                    size={14}
                    color={
                      feedback.isError ? nintendoTheme.colors.famicomRed : '#275E33'
                    }
                  />
                  <Text
                    style={[
                      styles.feedbackBannerText,
                      {
                        color: feedback.isError
                          ? nintendoTheme.colors.famicomRed
                          : '#275E33',
                      },
                    ]}
                  >
                    {feedback.text}
                  </Text>
                </View>
              )}

              <View style={styles.footerButtons}>
                <WiiButton
                  title="CERRAR"
                  variant="secondary"
                  onPress={onClose}
                  style={{ flex: 1 }}
                />
                {isMe && (
                  <WiiButton
                    title={isSaving ? 'GUARDANDO...' : 'GUARDAR PERFIL'}
                    variant="mint"
                    onPress={handleSaveProfile}
                    disabled={isSaving}
                    icon={<Ionicons name="save-outline" size={14} color="#FFFFFF" />}
                    style={{ flex: 1.4 }}
                  />
                )}
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
    backgroundColor: 'rgba(20, 24, 28, 0.55)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 430,
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
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  headerSubtitle: {
    fontSize: 9,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  closeBtn: {
    padding: 4,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  loadingBox: {
    padding: 32,
    alignItems: 'center',
    gap: 10,
  },
  loadingText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  scrollArea: {
    marginTop: 10,
  },
  scrollContent: {
    gap: 12,
    paddingBottom: 6,
  },
  identityBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FAF9F6',
    padding: 10,
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
  },
  avatarFrame: {
    width: 58,
    height: 58,
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 2,
    padding: 2,
    backgroundColor: '#FFFFFF',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 3,
  },
  avatarFallback: {
    width: '100%',
    height: '100%',
    borderRadius: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarFallbackLetter: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  identityTextCol: {
    flex: 1,
    gap: 2,
  },
  identityDisplayName: {
    fontSize: 15,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  identityUsername: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  avatarButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  avatarActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
  },
  avatarActionText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  avatarDeleteBtn: {
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  avatarDeleteText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.famicomRed,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  reputationCard: {
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    padding: 10,
    gap: 6,
  },
  repHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  repBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#FDF6E4',
    borderWidth: 1,
    borderColor: '#F4E2B2',
    paddingVertical: 2,
    paddingHorizontal: 7,
    borderRadius: nintendoTheme.borderRadius.xs,
  },
  repBadgeLevel: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A5A00',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  repScoreText: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  progressBarTrack: {
    height: 8,
    backgroundColor: '#E2DFD8',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 4,
  },
  repMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  repNextText: {
    fontSize: 8,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  repCountersRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 2,
  },
  repStatBox: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#E2DFD8',
    paddingVertical: 4,
    alignItems: 'center',
  },
  repStatValue: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  repStatLabel: {
    fontSize: 7,
    fontWeight: '700',
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 1,
  },
  openRepModalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 5,
    marginTop: 2,
  },
  openRepModalText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.wiiBlue,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  formSection: {
    gap: 6,
  },
  labelWithCounter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  fieldLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  counterSmall: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  textInput: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingHorizontal: 10,
    paddingVertical: 7,
    fontSize: 12,
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  textArea: {
    minHeight: 68,
  },
  swatchesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  swatchCircle: {
    width: 26,
    height: 26,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.15)',
  },
  swatchSelected: {
    borderWidth: 2,
    borderColor: '#111315',
  },
  customHexRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  customHexLabel: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  hexInput: {
    width: 90,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  hexPreview: {
    width: 22,
    height: 22,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#24272A',
  },
  publicBioSection: {
    gap: 8,
  },
  bioReadBox: {
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 10,
  },
  bioReadText: {
    fontSize: 12,
    color: nintendoTheme.colors.textPrimary,
    lineHeight: 17,
  },
  friendActionWrap: {
    marginTop: 4,
  },
  friendStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EDF5EE',
    borderWidth: 1,
    borderColor: '#C2DEC5',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 6,
  },
  friendStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#275E33',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  pendingStatusTag: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FDF6E4',
    borderWidth: 1,
    borderColor: '#F4E2B2',
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 6,
  },
  pendingStatusText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#8A5A00',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  feedbackBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    padding: 8,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
  },
  feedbackOkBox: {
    backgroundColor: '#EDF5EE',
    borderColor: '#C2DEC5',
  },
  feedbackErrorBox: {
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  feedbackBannerText: {
    fontSize: 10,
    fontWeight: '700',
    flex: 1,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  footerButtons: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
});
