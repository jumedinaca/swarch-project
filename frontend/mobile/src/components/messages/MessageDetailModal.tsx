import React, { useState } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Platform,
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
          {/* Cabecera del diálogo */}
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <Ionicons name="chatbubble-outline" size={15} color={nintendoTheme.colors.textPrimary} />
              <Text style={styles.headerTitle}>NOTA // DETALLE</Text>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tarjeta PictoChat completa */}
          <PictoChatCard message={message} showDeleteAction={true} />

          {/* Estado de red social con el autor */}
          {!isAuthor && (
            <View style={styles.networkActionSection}>
              {relationship === 'friend' && (
                <View style={styles.friendBadgeBox}>
                  <Ionicons name="checkmark-circle-outline" size={14} color="#275E33" />
                  <Text style={styles.friendBadgeText}>AMIGO EN TU RED SOCIAL</Text>
                </View>
              )}

              {relationship === 'outgoing' && (
                <View style={styles.pendingBadgeBox}>
                  <Ionicons name="time-outline" size={14} color="#8A5A00" />
                  <Text style={styles.pendingBadgeText}>SOLICITUD ENVIADA (PENDIENTE)</Text>
                </View>
              )}

              {relationship === 'incoming' && (
                <View style={styles.incomingActionBox}>
                  <View style={styles.incomingTextRow}>
                    <Ionicons name="mail-unread-outline" size={14} color={nintendoTheme.colors.wiiBlue} />
                    <Text style={styles.incomingText}>¡TE HA ENVIADO UNA SOLICITUD!</Text>
                  </View>
                  <WiiButton
                    title="ACEPTAR AMISTAD"
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
                    title={isSending ? 'CONECTANDO...' : 'CONECTAR COMO AMIGO'}
                    variant="mint"
                    size="sm"
                    icon={<Ionicons name="person-add-outline" size={13} color="#FFFFFF" />}
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
            <Ionicons name="location-outline" size={13} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.geoCoordsText}>
              COORDS // LAT {message.latitude.toFixed(5)}, LNG {message.longitude.toFixed(5)}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <WiiButton
              title="CERRAR"
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
    backgroundColor: 'rgba(20, 24, 28, 0.55)',
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.borderDark,
    padding: 14,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  closeBtn: {
    padding: 4,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  geoInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECEAE3',
    padding: 8,
    borderRadius: nintendoTheme.borderRadius.xs,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  geoCoordsText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  networkActionSection: {
    marginTop: 8,
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 8,
  },
  friendBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EDF5EE',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#C2DEC5',
  },
  friendBadgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#275E33',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  pendingBadgeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#FDF6E4',
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#F4E2B2',
  },
  pendingBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#8A5A00',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  incomingActionBox: {
    gap: 6,
  },
  incomingTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'center',
  },
  incomingText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  connectBox: {
    width: '100%',
  },
  feedbackText: {
    fontSize: 10,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  feedbackSuccess: {
    color: '#275E33',
  },
  feedbackError: {
    color: nintendoTheme.colors.famicomRed,
  },
  buttonRow: {
    marginTop: 10,
  },
});
