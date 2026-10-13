import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoMessage } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useNetwork } from '../../context/NetworkContext';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { PictoChatCard } from '../common/PictoChatCard';
import { WiiButton } from '../common/WiiButton';

interface MessageDetailModalProps {
  message: GeoMessage | null;
  visible: boolean;
  onClose: () => void;
}

export const MessageDetailModal: React.FC<MessageDetailModalProps> = ({
  message,
  visible,
  onClose,
}) => {
  const { user } = useAuth();
  const {
    getRelationshipStatus,
    sendFriendRequest,
    incomingRequests,
    acceptFriendRequest,
  } = useNetwork();

  const [isSending, setIsSending] = useState(false);
  const [networkFeedback, setNetworkFeedback] = useState<{ text: string; isError: boolean } | null>(null);

  if (!message) return null;

  const isAuthor = user?.id === message.authorId;
  const relationship = isAuthor ? 'self' : getRelationshipStatus(message.authorId);

  const handleSendFriendRequest = async () => {
    setIsSending(true);
    setNetworkFeedback(null);
    try {
      const res = await sendFriendRequest(message.authorId);
      if (res.success) {
        setNetworkFeedback({ text: '¡Solicitud de amistad enviada!', isError: false });
      } else {
        setNetworkFeedback({ text: res.error || 'No se pudo enviar la solicitud.', isError: true });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleAcceptIncoming = async () => {
    const incomingReq = incomingRequests.find(
      (r) => r.requested_by === message.authorId || r.other_user_id === message.authorId
    );
    if (!incomingReq) return;

    setIsSending(true);
    try {
      const res = await acceptFriendRequest(incomingReq.id);
      if (res.success) {
        setNetworkFeedback({ text: '¡Ahora son amigos!', isError: false });
      }
    } finally {
      setIsSending(false);
    }
  };

  const handleClose = () => {
    setNetworkFeedback(null);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={handleClose}
        >
          <View style={styles.modalBackdrop} />
        </TouchableOpacity>

        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <Ionicons name="chatbubble-ellipses" size={18} color={nintendoTheme.colors.wiiBlue} />
              <Text style={styles.headerTitle}>Detalle del Mensaje</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tarjeta PictoChat completa */}
          <PictoChatCard message={message} showDeleteAction={true} />

          {/* Estado de red social con el autor */}
          {!isAuthor && (
            <View style={styles.networkActionSection}>
              {relationship === 'friend' && (
                <View style={styles.friendBadgeBox}>
                  <Ionicons name="sparkles" size={15} color="#15803D" />
                  <Text style={styles.friendBadgeText}>¡Es tu amigo en GeoPicto!</Text>
                </View>
              )}

              {relationship === 'outgoing' && (
                <View style={styles.pendingBadgeBox}>
                  <Ionicons name="time-outline" size={15} color="#B45309" />
                  <Text style={styles.pendingBadgeText}>Solicitud de amistad enviada (pendiente)</Text>
                </View>
              )}

              {relationship === 'incoming' && (
                <View style={styles.incomingActionBox}>
                  <View style={styles.incomingTextRow}>
                    <Ionicons name="mail-unread-outline" size={15} color={nintendoTheme.colors.wiiBlue} />
                    <Text style={styles.incomingText}>¡Te ha enviado una solicitud de amistad!</Text>
                  </View>
                  <WiiButton
                    title="Aceptar Amistad"
                    variant="mint"
                    size="sm"
                    onPress={handleAcceptIncoming}
                    disabled={isSending}
                  />
                </View>
              )}

              {relationship === 'none' && (
                <View style={styles.connectBox}>
                  <WiiButton
                    title={isSending ? 'Conectando...' : 'Conectar como Amigo'}
                    variant="mint"
                    size="sm"
                    icon={<Ionicons name="person-add" size={14} color="#FFFFFF" />}
                    onPress={handleSendFriendRequest}
                    disabled={isSending}
                    style={{ width: '100%' }}
                  />
                </View>
              )}

              {networkFeedback && (
                <Text
                  style={[
                    styles.feedbackText,
                    networkFeedback.isError ? styles.feedbackError : styles.feedbackSuccess,
                  ]}
                >
                  {networkFeedback.text}
                </Text>
              )}
            </View>
          )}

          {/* Información contextual geoespacial */}
          <View style={styles.geoInfoBox}>
            <Ionicons name="location-outline" size={14} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.geoCoordsText}>
              Coordenadas: {message.latitude.toFixed(5)}, {message.longitude.toFixed(5)}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <WiiButton
              title="Cerrar"
              variant="secondary"
              onPress={handleClose}
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
    backgroundColor: 'rgba(28, 40, 36, 0.45)',
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.lg,
    borderWidth: 2,
    borderColor: '#384347',
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  closeBtn: {
    padding: 4,
    borderRadius: 16,
    backgroundColor: '#F0F4F3',
  },
  geoInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5F9F7',
    padding: 8,
    borderRadius: nintendoTheme.borderRadius.sm,
    marginTop: 8,
  },
  geoCoordsText: {
    fontSize: 11,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '500',
  },
  networkActionSection: {
    marginTop: 10,
    backgroundColor: '#FAFDFB',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#DFE8E4',
    padding: 10,
  },
  friendBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#DCFCE7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: nintendoTheme.borderRadius.pill,
  },
  friendBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  pendingBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: nintendoTheme.borderRadius.pill,
  },
  pendingBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B45309',
  },
  incomingActionBox: {
    gap: 8,
  },
  incomingTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  incomingText: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.wiiBlue,
  },
  connectBox: {
    width: '100%',
  },
  feedbackText: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 6,
  },
  feedbackSuccess: {
    color: '#15803D',
  },
  feedbackError: {
    color: '#DC2626',
  },
  buttonRow: {
    marginTop: 14,
  },
});
