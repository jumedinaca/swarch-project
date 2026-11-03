import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  useWindowDimensions,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { nintendoTheme } from '../../theme/nintendoTheme';

interface DeviceSimulatorFrameProps {
  children: React.ReactNode;
}

export const DeviceSimulatorFrame: React.FC<DeviceSimulatorFrameProps> = ({ children }) => {
  const { width, height } = useWindowDimensions();
  const [forceFullWidth, setForceFullWidth] = useState(false);

  // Pantalla de escritorio si el ancho supera 768px (en Web)
  const isDesktop = Platform.OS === 'web' && width > 768 && !forceFullWidth;

  if (!isDesktop) {
    return <View style={styles.fullscreenContainer}>{children}</View>;
  }

  // Dimensiones equilibradas tipo consola portátil Nintendo
  const consoleWidth = 420;
  const consoleHeight = Math.min(height - 32, 860);

  return (
    <View style={styles.desktopBackdrop}>
      {/* Barra de herramientas superior del entorno */}
      <View style={styles.desktopToolbar}>
        <View style={styles.toolbarBrand}>
          <View style={styles.dpadIcon}>
            <View style={styles.dpadV} />
            <View style={styles.dpadH} />
          </View>
          <Text style={styles.toolbarText}>GEOPICTO // SISTEMA NINTENDO</Text>
        </View>

        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => setForceFullWidth(true)}
          activeOpacity={0.7}
        >
          <Ionicons name="expand-outline" size={13} color={nintendoTheme.colors.textSecondary} />
          <Text style={styles.expandButtonText}>EXPANDIR</Text>
        </TouchableOpacity>
      </View>

      {/* Chasis exterior de consola portátil retro Nintendo */}
      <View style={[styles.consoleChassis, { width: consoleWidth, height: consoleHeight }]}>
        {/* Cabecera del chasis: LED de batería y relieve de marca */}
        <View style={styles.chassisHeader}>
          <View style={styles.batteryIndicator}>
            <View style={styles.powerLed} />
            <Text style={styles.batteryLabel}>POWER</Text>
          </View>

          <Text style={styles.brandEmboss}>GEOPICTO BOY</Text>

          <View style={styles.speakerGrille}>
            <View style={styles.speakerHole} />
            <View style={styles.speakerHole} />
            <View style={styles.speakerHole} />
          </View>
        </View>

        {/* Marco biselado de la pantalla LCD */}
        <View style={styles.screenBezel}>
          {/* Pantalla activa de la aplicación */}
          <View style={styles.screenInner}>
            {/* Barra de estado retro minimalista */}
            <View style={styles.statusBar}>
              <Text style={styles.statusTime}>12:30</Text>

              <View style={styles.statusCenterTag}>
                <Text style={styles.statusCenterText}>NINTENDO // PICTO-NET</Text>
              </View>

              <View style={styles.statusIcons}>
                <Text style={styles.statusMeter}>GPS [●●○]</Text>
              </View>
            </View>

            {/* Contenido interactivo */}
            <View style={styles.screenContent}>{children}</View>
          </View>
        </View>

        {/* Pie del chasis: Botones SELECT y START minimalistas */}
        <View style={styles.chassisFooter}>
          <View style={styles.controlPillContainer}>
            <View style={styles.controlButtonAngled} />
            <Text style={styles.controlLabel}>SELECT</Text>
          </View>

          <View style={styles.controlPillContainer}>
            <View style={styles.controlButtonAngled} />
            <Text style={styles.controlLabel}>START</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  fullscreenContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: nintendoTheme.colors.background,
  },
  desktopBackdrop: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: '#E6E4DD', // Tono ambiente de escritorio cálido y suave
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  desktopToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 420,
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  toolbarBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dpadIcon: {
    width: 14,
    height: 14,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dpadV: {
    position: 'absolute',
    width: 4,
    height: 14,
    backgroundColor: nintendoTheme.colors.textPrimary,
    borderRadius: 1,
  },
  dpadH: {
    position: 'absolute',
    width: 14,
    height: 4,
    backgroundColor: nintendoTheme.colors.textPrimary,
    borderRadius: 1,
  },
  toolbarText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FAF9F6',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#D4D0C5',
    gap: 5,
  },
  expandButtonText: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  consoleChassis: {
    backgroundColor: '#EAE8E1', // Chasis tipo Game Boy Pocket / Nintendo DS Lite
    borderRadius: 18,
    paddingTop: 12,
    paddingBottom: 14,
    paddingHorizontal: 14,
    borderWidth: 1.5,
    borderColor: '#CCC8BC',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
    display: 'flex',
    flexDirection: 'column',
  },
  chassisHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    marginBottom: 8,
  },
  batteryIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  powerLed: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#22C55E', // LED verde activo
    borderWidth: 1,
    borderColor: '#15803D',
  },
  batteryLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#768087',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  brandEmboss: {
    fontSize: 11,
    fontWeight: '900',
    color: '#8A9298',
    letterSpacing: 1.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  speakerGrille: {
    flexDirection: 'row',
    gap: 3,
  },
  speakerHole: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#C5C1B4',
  },
  screenBezel: {
    flex: 1,
    backgroundColor: '#32363B', // Bisel oscuro elegante de pantalla retro
    borderRadius: 10,
    padding: 3,
    borderWidth: 1,
    borderColor: '#202326',
    overflow: 'hidden',
  },
  screenInner: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
    borderRadius: 7,
    overflow: 'hidden',
  },
  statusBar: {
    height: 26,
    backgroundColor: '#FAF9F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E2DFD8',
    zIndex: 20,
  },
  statusTime: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statusCenterTag: {
    backgroundColor: '#ECEAE3',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 2,
  },
  statusCenterText: {
    fontSize: 8,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.6,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusMeter: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  screenContent: {
    flex: 1,
    width: '100%',
  },
  chassisFooter: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 32,
    marginTop: 10,
  },
  controlPillContainer: {
    alignItems: 'center',
    gap: 3,
  },
  controlButtonAngled: {
    width: 32,
    height: 8,
    backgroundColor: '#8C949A',
    borderRadius: 4,
    transform: [{ rotate: '-25deg' }],
    borderWidth: 1,
    borderColor: '#72797E',
  },
  controlLabel: {
    fontSize: 8,
    fontWeight: '800',
    color: '#8A9298',
    letterSpacing: 0.8,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
});
