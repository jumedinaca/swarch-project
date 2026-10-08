import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { WiiButton } from '../common/WiiButton';
import {
  DEFAULT_BOGOTA_GROUND_ALTITUDE,
  getFloorFromRelativeAltitude,
} from '../../utils/geoUtils';

interface AltitudePreset {
  relativeMeters: number;
  label: string;
  floorText: string;
  icon: keyof typeof Ionicons.glyphMap;
  badge: string;
  description: string;
}

const ALTITUDE_PRESETS: AltitudePreset[] = [
  {
    relativeMeters: 0,
    label: 'Planta Baja / Calle',
    floorText: 'Suelo (0m)',
    icon: 'walk-outline',
    badge: '0m',
    description: 'Nivel del terreno en la calle o plazoleta pública',
  },
  {
    relativeMeters: 10,
    label: 'Edificio • Piso 3',
    floorText: 'Piso 3 (+10m)',
    icon: 'business-outline',
    badge: '+10m',
    description: 'Altura baja en edificio de oficinas o aulas',
  },
  {
    relativeMeters: 25,
    label: 'Edificio • Piso 7',
    floorText: 'Piso 7 (+25m)',
    icon: 'business-outline',
    badge: '+25m',
    description: 'Nivel medio en edificio (biblioteca o torre residencial)',
  },
  {
    relativeMeters: 50,
    label: 'Edificio • Piso 15',
    floorText: 'Piso 15 (+50m)',
    icon: 'business',
    badge: '+50m',
    description: 'Gran altura con vista panorámica sobre los tejados',
  },
  {
    relativeMeters: 80,
    label: 'Torre • Terraza Alta',
    floorText: 'Torre (+80m)',
    icon: 'hardware-chip-outline',
    badge: '+80m',
    description: 'Rascacielos o torre corporativa en el centro',
  },
  {
    relativeMeters: 300,
    label: 'Mirador / Cerros',
    floorText: 'Cerro (+300m)',
    icon: 'trail-sign-outline',
    badge: '+300m',
    description: 'Cima de cerros orientales o mirador elevado',
  },
];

interface AltitudeConfigModalProps {
  visible: boolean;
  onClose: () => void;
  currentAltitude?: number | null;
  currentRelativeAltitude?: number;
  onSelectAltitude: (altitude: number, relativeAltitude: number) => void;
}

export const AltitudeConfigModal: React.FC<AltitudeConfigModalProps> = ({
  visible,
  onClose,
  currentAltitude = DEFAULT_BOGOTA_GROUND_ALTITUDE,
  currentRelativeAltitude = 0,
  onSelectAltitude,
}) => {
  const [selectedRel, setSelectedRel] = useState<number>(currentRelativeAltitude ?? 0);
  const [isReadingGps, setIsReadingGps] = useState(false);
  const [gpsStatusMessage, setGpsStatusMessage] = useState<string | null>(null);

  const absoluteAltitude = DEFAULT_BOGOTA_GROUND_ALTITUDE + selectedRel;
  const isElevated = selectedRel >= 4;
  const currentFloor = getFloorFromRelativeAltitude(selectedRel);

  // Intentar leer altitud real de los sensores GPS del dispositivo
  const handleReadGpsSensor = async () => {
    setIsReadingGps(true);
    setGpsStatusMessage(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setGpsStatusMessage('Permiso de GPS no concedido.');
        return;
      }

      const loc = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Highest,
      });

      if (loc.coords.altitude !== null && loc.coords.altitude !== undefined && loc.coords.altitude > 0) {
        const detectedAlt = Math.round(loc.coords.altitude);
        const relAlt = Math.max(0, detectedAlt - DEFAULT_BOGOTA_GROUND_ALTITUDE);
        setSelectedRel(relAlt);
        onSelectAltitude(detectedAlt, relAlt);
        setGpsStatusMessage(
          `¡Sensor detectó ${detectedAlt}m s.n.m.! (+${relAlt}m sobre base Bogotá)`
        );
      } else {
        setGpsStatusMessage(
          'El navegador/dispositivo no reporta barómetro vertical. Usando simulación de pisos.'
        );
      }
    } catch (err: any) {
      setGpsStatusMessage('No se pudo obtener la altitud del sensor: ' + (err.message || 'Error'));
    } finally {
      setIsReadingGps(false);
    }
  };

  const handleApplyPreset = (relMeters: number) => {
    setSelectedRel(relMeters);
    onSelectAltitude(DEFAULT_BOGOTA_GROUND_ALTITUDE + relMeters, relMeters);
  };

  const handleAdjustFine = (delta: number) => {
    const nextRel = Math.max(0, Math.min(600, selectedRel + delta));
    setSelectedRel(nextRel);
    onSelectAltitude(DEFAULT_BOGOTA_GROUND_ALTITUDE + nextRel, nextRel);
  };

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
              <View style={[styles.iconSquare, isElevated && styles.iconSquareElevated]}>
                <Ionicons
                  name={isElevated ? 'business' : 'layers'}
                  size={15}
                  color="#FFFFFF"
                />
              </View>
              <View>
                <Text style={styles.modalTitle}>ALTÍMETRO 3D • EDIFICIO</Text>
                <Text style={styles.modalSubtitleTag}>RADAR VERTICAL DS</Text>
              </View>
            </View>

            <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
              <Ionicons name="close" size={18} color={nintendoTheme.colors.textPrimary} />
            </TouchableOpacity>
          </View>

          {/* Tarjeta de HUD de Altitud Actual */}
          <View style={[styles.hudDisplayCard, isElevated && styles.hudDisplayCardElevated]}>
            <View style={styles.hudTopRow}>
              <View style={styles.hudBadgeGroup}>
                <View
                  style={[
                    styles.hudStatusDot,
                    { backgroundColor: isElevated ? '#2CD96B' : '#7A8C85' },
                  ]}
                />
                <Text style={styles.hudStatusText}>
                  {isElevated ? 'ELEVADO EN EDIFICIO' : 'EN NIVEL DEL SUELO'}
                </Text>
              </View>

              <View style={styles.hudAltitudeNumbers}>
                <Text style={styles.hudAltLarge}>
                  {isElevated ? `+${selectedRel}m` : '0m'}
                </Text>
                <Text style={styles.hudAltSub}>
                  ({absoluteAltitude.toLocaleString()} m s.n.m.)
                </Text>
              </View>
            </View>

            <View style={styles.hudFloorRow}>
              <Ionicons
                name={isElevated ? 'business' : 'walk'}
                size={14}
                color={isElevated ? '#0D6832' : nintendoTheme.colors.textSecondary}
              />
              <Text style={styles.hudFloorText}>
                {isElevated
                  ? `Piso estimado: ${currentFloor} en estructura 3D`
                  : 'Nivel calle / Terreno base Bogotá'}
              </Text>
            </View>

            {/* Micro controles de ajuste fino (+5m / -5m) */}
            <View style={styles.fineAdjustRow}>
              <Text style={styles.fineAdjustLabel}>Ajuste fino de altura:</Text>
              <View style={styles.fineBtnGroup}>
                <TouchableOpacity
                  style={[styles.fineBtn, selectedRel <= 0 && styles.fineBtnDisabled]}
                  onPress={() => handleAdjustFine(-5)}
                  disabled={selectedRel <= 0}
                >
                  <Text style={styles.fineBtnText}>-5m</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.fineBtn}
                  onPress={() => handleAdjustFine(5)}
                >
                  <Text style={styles.fineBtnText}>+5m</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Botón de Sensor GPS en vivo */}
          <TouchableOpacity
            style={styles.gpsSensorBtn}
            onPress={handleReadGpsSensor}
            activeOpacity={0.8}
            disabled={isReadingGps}
          >
            <Ionicons
              name={isReadingGps ? 'hourglass-outline' : 'locate'}
              size={15}
              color={nintendoTheme.colors.roomA}
            />
            <Text style={styles.gpsSensorBtnText}>
              {isReadingGps ? 'LEYENDO SENSOR GPS...' : 'CALIBRAR CON SENSOR GPS REAL'}
            </Text>
          </TouchableOpacity>

          {gpsStatusMessage && (
            <View style={styles.gpsMessageCard}>
              <Ionicons name="information-circle" size={13} color={nintendoTheme.colors.roomA} />
              <Text style={styles.gpsMessageText}>{gpsStatusMessage}</Text>
            </View>
          )}

          <Text style={styles.presetSectionTitle}>
            SIMULAR PISO DE EDIFICIO (PRUEBAS):
          </Text>

          {/* Lista de Presets */}
          <ScrollView style={styles.presetList} showsVerticalScrollIndicator={false}>
            {ALTITUDE_PRESETS.map((preset) => {
              const isSelected = selectedRel === preset.relativeMeters;
              return (
                <TouchableOpacity
                  key={preset.relativeMeters}
                  style={[
                    styles.presetCard,
                    isSelected && styles.presetCardSelected,
                  ]}
                  onPress={() => handleApplyPreset(preset.relativeMeters)}
                  activeOpacity={0.75}
                >
                  <View style={styles.presetLeft}>
                    <View
                      style={[
                        styles.presetIconBox,
                        isSelected && styles.presetIconBoxSelected,
                      ]}
                    >
                      <Ionicons
                        name={preset.icon}
                        size={17}
                        color={isSelected ? nintendoTheme.colors.roomA : nintendoTheme.colors.textSecondary}
                      />
                    </View>
                    <View style={styles.presetInfo}>
                      <View style={styles.presetHeaderRow}>
                        <Text
                          style={[
                            styles.presetLabel,
                            isSelected && styles.presetLabelSelected,
                          ]}
                        >
                          {preset.label}
                        </Text>
                        <View
                          style={[
                            styles.presetBadge,
                            isSelected && styles.presetBadgeSelected,
                          ]}
                        >
                          <Text
                            style={[
                              styles.presetBadgeText,
                              isSelected && styles.presetBadgeTextSelected,
                            ]}
                          >
                            {preset.badge}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.presetDesc}>{preset.description}</Text>
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
          </ScrollView>

          {/* Botón de cierre / aplicar */}
          <View style={styles.actionRow}>
            <WiiButton
              title="APLICAR Y VER EN MAPA 3D"
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
    maxWidth: 420,
    maxHeight: '92%',
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 2,
    borderColor: nintendoTheme.colors.pictoBorder,
    padding: 14,
    ...nintendoTheme.shadows.pictoCard,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: 8,
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
  iconSquareElevated: {
    backgroundColor: '#1E7E34',
    borderColor: '#115021',
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
  hudDisplayCard: {
    backgroundColor: '#F2F7F4',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    borderColor: '#BAC7C1',
    padding: 10,
    marginTop: 10,
  },
  hudDisplayCardElevated: {
    backgroundColor: '#EEF9F1',
    borderColor: '#2CD96B',
  },
  hudTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  hudBadgeGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  hudStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  hudStatusText: {
    fontSize: 9.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.4,
  },
  hudAltitudeNumbers: {
    alignItems: 'flex-end',
  },
  hudAltLarge: {
    fontSize: 18,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
    fontVariant: ['tabular-nums'],
  },
  hudAltSub: {
    fontSize: 9.5,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
  },
  hudFloorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#DCE7E1',
  },
  hudFloorText: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  fineAdjustRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#DCE7E1',
  },
  fineAdjustLabel: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
  },
  fineBtnGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  fineBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#BAC7C1',
    borderRadius: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  fineBtnDisabled: {
    opacity: 0.4,
  },
  fineBtnText: {
    fontSize: 10,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
  },
  gpsSensorBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#EBF6FC',
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.roomA,
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 7,
    marginTop: 8,
  },
  gpsSensorBtnText: {
    fontSize: 10.5,
    fontWeight: '900',
    color: nintendoTheme.colors.roomA,
    letterSpacing: 0.4,
  },
  gpsMessageCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FBFD',
    borderWidth: 1,
    borderColor: '#CFE4F1',
    borderRadius: 4,
    padding: 6,
    marginTop: 6,
  },
  gpsMessageText: {
    fontSize: 9.5,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  presetSectionTitle: {
    fontSize: 10,
    fontWeight: '900',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
  },
  presetList: {
    maxHeight: 180,
  },
  presetCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FAFCFB',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    borderColor: '#BAC7C1',
    padding: 8,
    marginBottom: 6,
  },
  presetCardSelected: {
    backgroundColor: '#EFF8FC',
    borderColor: nintendoTheme.colors.roomA,
    borderBottomWidth: 2.5,
  },
  presetLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  presetIconBox: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#EEF3F1',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#D4DFDA',
  },
  presetIconBoxSelected: {
    backgroundColor: '#D8F1FB',
    borderColor: nintendoTheme.colors.roomA,
  },
  presetInfo: {
    flex: 1,
  },
  presetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  presetLabel: {
    fontSize: 11.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
  },
  presetLabelSelected: {
    color: nintendoTheme.colors.roomA,
    fontWeight: '900',
  },
  presetBadge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 2,
    backgroundColor: '#E4ECE9',
  },
  presetBadgeSelected: {
    backgroundColor: nintendoTheme.colors.roomA,
  },
  presetBadgeText: {
    fontSize: 9.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
  },
  presetBadgeTextSelected: {
    color: '#FFFFFF',
  },
  presetDesc: {
    fontSize: 9.5,
    color: nintendoTheme.colors.textSecondary,
    marginTop: 1,
  },
  radioSquare: {
    width: 16,
    height: 16,
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
  actionRow: {
    marginTop: 10,
  },
});
