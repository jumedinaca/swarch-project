import React from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Platform,
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
    label: 'CORTO',
    badge: '100 M',
    description: 'Zona inmediata y pasos cercanos alrededor',
    icon: 'walk-outline',
  },
  {
    value: 300,
    label: 'MEDIO',
    badge: '300 M',
    description: 'Entorno local, manzana y plazas contiguas',
    icon: 'navigate-circle-outline',
  },
  {
    value: 500,
    label: 'LARGO',
    badge: '500 M',
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
          {/* Cabecera estilo menú de configuración Nintendo */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconBox}>
                <Ionicons name="radio" size={13} color="#FFFFFF" />
              </View>
              <Text style={styles.modalTitle}>RADAR // ALCANCE DE MENSAJES</Text>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Selecciona el radio de detección para sincronizar notas en tu ubicación o en la vista del mapa:
          </Text>

          {/* Opciones de rango en formato Bento Cards */}
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
                  activeOpacity={0.75}
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
                        size={17}
                        color={isSelected ? '#FFFFFF' : nintendoTheme.colors.textSecondary}
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
                            [{opt.badge}]
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.optionDescription}>{opt.description}</Text>
                    </View>
                  </View>

                  <View
                    style={[
                      styles.radioSquare,
                      isSelected && styles.radioSquareSelected,
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
            <Ionicons name="information-circle-outline" size={14} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.infoText}>
              El radio en metros es constante en el plano geodésico y no varía con el nivel de zoom.
            </Text>
          </View>

          {/* Botón de confirmación */}
          <View style={styles.actionRow}>
            <WiiButton
              title="ACEPTAR"
              variant="mint"
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
    maxWidth: 390,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.borderDark,
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconBox: {
    width: 22,
    height: 22,
    borderRadius: 2,
    backgroundColor: nintendoTheme.colors.retroDpad,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  closeIconButton: {
    width: 26,
    height: 26,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#E2DFD8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalSubtitle: {
    fontSize: 11,
    color: nintendoTheme.colors.textSecondary,
    lineHeight: 16,
    marginTop: 10,
    marginBottom: 10,
  },
  optionsList: {
    gap: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAF9F6',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderLight,
    padding: 10,
  },
  optionCardSelected: {
    backgroundColor: '#FFFFFF',
    borderColor: nintendoTheme.colors.borderDark,
    borderWidth: 1.5,
  },
  optionLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  optionIconContainer: {
    width: 32,
    height: 32,
    borderRadius: 2,
    backgroundColor: '#ECEAE3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  optionIconContainerSelected: {
    backgroundColor: nintendoTheme.colors.retroDpad,
    borderColor: '#111315',
  },
  optionTextContainer: {
    flex: 1,
  },
  optionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  optionLabel: {
    fontSize: 12,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  optionLabelSelected: {
    color: nintendoTheme.colors.textPrimary,
  },
  badgePill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    backgroundColor: '#ECEAE3',
  },
  badgePillSelected: {
    backgroundColor: nintendoTheme.colors.miiverseGreenLight,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.miiverseGreenBorder,
  },
  badgeText: {
    fontSize: 9,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  badgeTextSelected: {
    color: nintendoTheme.colors.miiverseGreen,
  },
  optionDescription: {
    fontSize: 10,
    color: nintendoTheme.colors.textMuted,
    marginTop: 2,
  },
  radioSquare: {
    width: 18,
    height: 18,
    borderRadius: 2,
    borderWidth: 1.5,
    borderColor: '#B0B8BF',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
  radioSquareSelected: {
    borderColor: nintendoTheme.colors.borderDark,
    backgroundColor: '#FAF9F6',
  },
  radioInnerDot: {
    width: 8,
    height: 8,
    borderRadius: 1,
    backgroundColor: nintendoTheme.colors.retroDpad,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECEAE3',
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#DFDCD4',
  },
  infoText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    flex: 1,
    lineHeight: 14,
  },
  actionRow: {
    marginTop: 12,
  },
});
