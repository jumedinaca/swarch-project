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
          {/* Cabecera estilo Nintendo DS PictoChat */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.iconSquare}>
                <Ionicons name="radio" size={15} color="#FFFFFF" />
              </View>
              <View>
                <Text style={styles.modalTitle}>ALCANCE DE TRANSMISIÓN</Text>
                <Text style={styles.modalSubtitleTag}>RADAR DS WIRELESS</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          <Text style={styles.modalSubtitle}>
            Selecciona el radio de exploración para descubrir notas en el mapa:
          </Text>

          {/* Opciones de rango táctiles PictoChat */}
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
                        size={18}
                        color={isSelected ? nintendoTheme.colors.roomA : nintendoTheme.colors.textSecondary}
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
                          {opt.label.toUpperCase()}
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
                    {isSelected && <View style={styles.radioInnerSquare} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Nota informativa */}
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={15} color={nintendoTheme.colors.roomA} />
            <Text style={styles.infoText}>
              El radio en metros permanece constante en la proyección del terreno independiente de la perspectiva.
            </Text>
          </View>

          {/* Botón de confirmación */}
          <View style={styles.actionRow}>
            <WiiButton
              title="APLICAR"
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
    backgroundColor: 'rgba(24, 32, 35, 0.6)',
  },
  modalCard: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 2,
    borderColor: nintendoTheme.colors.pictoBorder,
    padding: 16,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  iconSquare: {
    width: 26,
    height: 26,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: nintendoTheme.colors.roomA,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#125C8E',
  },
  modalTitle: {
    fontSize: 13.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  modalSubtitleTag: {
    fontSize: 8.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  closeIconButton: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#F0F6F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  modalSubtitle: {
    fontSize: 11.5,
    fontWeight: '600',
    color: nintendoTheme.colors.textSecondary,
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 10,
  },
  optionsList: {
    gap: 8,
  },
  optionCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFCFB',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    borderColor: '#BAC7C1',
    padding: 10,
  },
  optionCardSelected: {
    backgroundColor: '#EFF8FC',
    borderColor: nintendoTheme.colors.roomA,
    borderBottomWidth: 2.5,
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
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#EEF3F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4DFDA',
  },
  optionIconContainerSelected: {
    backgroundColor: '#D8F1FB',
    borderColor: nintendoTheme.colors.roomA,
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
    fontSize: 12.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.4,
  },
  optionLabelSelected: {
    color: nintendoTheme.colors.roomA,
    fontWeight: '900',
  },
  badgePill: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    backgroundColor: '#E4ECE9',
  },
  badgePillSelected: {
    backgroundColor: nintendoTheme.colors.roomA,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  badgeTextSelected: {
    color: '#FFFFFF',
  },
  optionDescription: {
    fontSize: 10.5,
    color: nintendoTheme.colors.textSecondary,
    marginTop: 2,
  },
  radioSquare: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 1.5,
    borderColor: '#BAC7C1',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 6,
  },
  radioSquareSelected: {
    borderColor: nintendoTheme.colors.roomA,
  },
  radioInnerSquare: {
    width: 8,
    height: 8,
    borderRadius: 1.5,
    backgroundColor: nintendoTheme.colors.roomA,
  },
  infoBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3FAF6',
    borderRadius: nintendoTheme.borderRadius.xs,
    padding: 8,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  infoText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    flex: 1,
    lineHeight: 14,
    fontWeight: '600',
  },
  actionRow: {
    marginTop: 12,
  },
});
