import React from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoMessage } from '../../types';
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
  if (!message) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <TouchableOpacity
          style={StyleSheet.absoluteFill}
          activeOpacity={1}
          onPress={onClose}
        >
          <View style={styles.modalBackdrop} />
        </TouchableOpacity>

        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <View style={styles.headerLeft}>
              <Ionicons name="chatbubble-ellipses" size={18} color={nintendoTheme.colors.wiiBlue} />
              <Text style={styles.headerTitle}>Detalle del Mensaje</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={20} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* Tarjeta PictoChat completa */}
          <PictoChatCard message={message} showDeleteAction={true} />

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
  buttonRow: {
    marginTop: 14,
  },
});
