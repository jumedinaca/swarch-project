import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RangeDistance } from '../../types';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';

interface RangeConfigModalProps {
  visible: boolean;
  onClose: () => void;
  currentRange: RangeDistance;
  onSelectRange: (range: RangeDistance) => void;
}

interface RangeOption {
  value: RangeDistance;
  label: string;
  badge: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
}

const RANGE_OPTIONS: RangeOption[] = [
  {
    value: 100,
    label: 'Corto',
    badge: '100 m',
    description: 'Zona inmediata y pasos cercanos alrededor',
    icon: 'walk-outline',
  },
  {
    value: 300,
    label: 'Medio',
    badge: '300 m',
    description: 'Entorno local, manzana y plazas contiguas',
    icon: 'navigate-circle-outline',
  },
  {
    value: 500,
    label: 'Largo',
    badge: '500 m',
    description: 'Exploración extendida de todo el vecindario',
    icon: 'earth-outline',
  },
];

export const RangeConfigModal: React.FC<RangeConfigModalProps> = ({
  visible,
  onClose,
  currentRange,
  onSelectRange,
}) => {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.modalBackdrop}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={onClose}
          />
        </View>

        <View style={styles.modalCard}>
          {/* Cabecera estilo Nintendo DS / Wii */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconCircle}>
                <Ionicons name="radio" size={16} color="#FFFFFF" />
              </View>
              <Text style={styles.modalTitle}>Alcance de Mensajes</Text>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={20} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Selecciona el radio de búsqueda para descubrir notas geoespaciales en tu ubicación o en la vista libre del mapa:
          </Text>

          {/* Opciones de rango */}
          <View style={styles.optionsList}>
            {RANGE_OPTIONS.map((opt) => {
              const isSelected = currentRange === opt.value;
              return (
                <TouchableOpacity
                  key={opt.value}
                  style={[
                    styles.optionCard,
                    isSelected && styles.optionCardSelected,
                  ]}
                  onPress={() => onSelectRange(opt.value)}
                  activeOpacity={0.8}
                >
                  <View style={styles.optionLeftGroup}>
                    <View
                      style={[
                        styles.optionIconContainer,
                        isSelected && styles.optionIconContainerSelected,
                      ]}
                    >
                      <Ionicons
                        name={opt.icon}
                        size={20}
                        color={isSelected ? nintendoTheme.colors.wiiBlue : nintendoTheme.colors.textSecondary}
                      />
                    </View>
                    <View style={styles.optionTextContainer}>
                      <View style={styles.optionTitleRow}>
                        <Text
                          style={[
                            styles.optionLabel,
                            isSelected && styles.optionLabelSelected,
                          ]}
                        >
                          {opt.label}
                        </Text>
                        <View
                          style={[
                            styles.badgePill,
                            isSelected && styles.badgePillSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.badgeText,
                              isSelected && styles.badgeTextSelected,
                            ]}
                          >
                            {opt.badge}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.optionDescription}>{opt.description}</Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.radioCircle,
                      isSelected && styles.radioCircleSelected,
                    ]}
                  >
                    {isSelected && <View style={styles.radioInnerDot} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Nota informativa */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle-outline" size={16} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.infoText}>
              El radio en metros es constante en el mapa y no varía según el nivel de zoom de la cámara.
            </Text>
          </View>

          {/* Botón de confirmación */}
          <View style={styles.actionRow}>
            <WiiButton
              title="Aceptar"
              variant="mint"
              onPress={onClose}
              style={{ flex: 1 }}
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
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.lg,
    borderWidth: 2,
    borderColor: '#384347',
    padding: 18,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 12,
    borderBottomWidth: 1.5,
    borderBottomColor: '#E6ECE9',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: nintendoTheme.colors.wiiBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  closeIconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F6F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    fontSize: 12,
    color: nintendoTheme.colors.textSecondary,
    lineHeight: 18,
    marginTop: 10,
    marginBottom: 12,
  },
  optionsList: {
    gap: 10,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFCFB',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: '#D8E2DF',
    padding: 12,
  },
  optionCardSelected: {
    backgroundColor: '#EFF8FC',
    borderColor: nintendoTheme.colors.wiiBlue,
  },
  optionLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  optionIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#EEF3F1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconContainerSelected: {
    backgroundColor: '#D8F1FB',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  optionLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  optionLabelSelected: {
    color: '#007AA8',
  },
  badgePill: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: nintendoTheme.borderRadius.pill,
    backgroundColor: '#E4ECE9',
  },
  badgePillSelected: {
    backgroundColor: nintendoTheme.colors.wiiBlue,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
  },
  badgeTextSelected: {
    color: '#FFFFFF',
  },
  optionDescription: {
    fontSize: 11,
    color: nintendoTheme.colors.textMuted,
    marginTop: 2,
  },
  radioCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#CBD5D1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radioCircleSelected: {
    borderColor: nintendoTheme.colors.wiiBlue,
  },
  radioInnerDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: nintendoTheme.colors.wiiBlue,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F5F8F7',
    borderRadius: nintendoTheme.borderRadius.sm,
    padding: 8,
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E2EBE8',
  },
  infoText: {
    fontSize: 11,
    color: nintendoTheme.colors.textSecondary,
    flex: 1,
    lineHeight: 15,
  },
  actionRow: {
    marginTop: 14,
  },
});
