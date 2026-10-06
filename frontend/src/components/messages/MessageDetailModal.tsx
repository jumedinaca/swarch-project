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
              <View style={styles.headerIconSquare}>
                <Ionicons name="chatbubble-ellipses" size={14} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.headerTitle}>PICTOCHAT • DETALLE</Text>
                <Text style={styles.headerSubtitle}>REGISTRO DE TRANSMISIÓN</Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Tarjeta PictoChat completa */}
          <PictoChatCard message={message} showDeleteAction={true} />

          {/* Información contextual geoespacial estilo coordenadas DS */}
          <View style={styles.geoInfoBox}>
            <Ionicons name="navigate-circle" size={15} color={nintendoTheme.colors.roomA} />
            <Text style={styles.geoCoordsText}>
              COORD: {message.latitude.toFixed(5)}, {message.longitude.toFixed(5)}
            </Text>
          </View>

          <View style={styles.buttonRow}>
            <WiiButton
              title="VOLVER"
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
    backgroundColor: 'rgba(24, 32, 35, 0.6)',
  },
  modalContainer: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 2,
    borderColor: nintendoTheme.colors.pictoBorder,
    padding: 14,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerIconSquare: {
    width: 26,
    height: 26,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: nintendoTheme.colors.roomA,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#125C8E',
  },
  headerTitle: {
    fontSize: 13.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  headerSubtitle: {
    fontSize: 8.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#F0F6F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  geoInfoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FAFDFB',
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  geoCoordsText: {
    fontSize: 10.5,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '800',
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  buttonRow: {
    marginTop: 12,
  },
});
