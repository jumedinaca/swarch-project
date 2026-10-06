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

  // Consideramos pantalla de escritorio si el ancho es superior a 768px (en Web)
  const isDesktop = Platform.OS === 'web' && width > 768 && !forceFullWidth;

  if (!isDesktop) {
    // Modo nativo / pantalla móvil completa
    return <View style={styles.fullscreenContainer}>{children}</View>;
  }

  // Dimensiones simuladas de smartphone (proporción tipo iPhone 15 / Galaxy estándar)
  const phoneWidth = 390;
  const phoneHeight = Math.min(height - 40, 840);

  return (
    <View style={styles.desktopBackdrop}>
      {/* Barra de control del simulador de escritorio */}
      <View style={styles.desktopToolbar}>
        <View style={styles.toolbarBadge}>
          <Ionicons name="phone-portrait-outline" size={16} color={nintendoTheme.colors.wiiBlue} />
          <Text style={styles.toolbarText}>Simulador Móvil Nintendo</Text>
        </View>

        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => setForceFullWidth(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="expand-outline" size={16} color={nintendoTheme.colors.textSecondary} />
          <Text style={styles.expandButtonText}>Pantalla Completa</Text>
        </TouchableOpacity>
      </View>

      {/* Carcasa del teléfono celular */}
      <View style={[styles.phoneBezel, { width: phoneWidth, height: phoneHeight }]}>
        {/* Borde metálico exterior sutil */}
        <View style={styles.phoneScreen}>
          {/* Barra de estado simulada del smartphone */}
          <View style={styles.statusBar}>
            <Text style={styles.statusTime}>12:30</Text>
            {/* Isla / Bocina frontal */}
            <View style={styles.cameraIsland}>
              <View style={styles.cameraLens} />
            </View>
            <View style={styles.statusIcons}>
              <Ionicons name="cellular" size={12} color="#4A5568" style={{ marginRight: 4 }} />
              <Ionicons name="wifi" size={12} color="#4A5568" style={{ marginRight: 4 }} />
              <Ionicons name="battery-full" size={13} color="#4A5568" />
            </View>
          </View>

          {/* Contenido de la aplicación */}
          <View style={styles.screenContent}>{children}</View>

          {/* Barra de gestos inferior de smartphone */}
          <View style={styles.homeIndicatorContainer}>
            <View style={styles.homeIndicator} />
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
    backgroundColor: '#EBF1F0', // Fondo neutro con toque menta suave
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
  },
  desktopToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: 390,
    marginBottom: 10,
    paddingHorizontal: 8,
  },
  toolbarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.pill,
    gap: 6,
    ...nintendoTheme.shadows.wiiSoft,
  },
  toolbarText: {
    fontSize: 12,
    fontWeight: '600',
    color: nintendoTheme.colors.textPrimary,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.pill,
    gap: 6,
  },
  expandButtonText: {
    fontSize: 12,
    color: nintendoTheme.colors.textSecondary,
  },
  phoneBezel: {
    backgroundColor: '#262C30',
    borderRadius: 48,
    padding: 10,
    shadowColor: '#0A251C',
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 12,
    borderWidth: 1.5,
    borderColor: '#4A5560',
  },
  phoneScreen: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
    borderRadius: 40,
    overflow: 'hidden',
    position: 'relative',
  },
  statusBar: {
    height: 38,
    backgroundColor: nintendoTheme.colors.cardBackground,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    zIndex: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F0',
  },
  statusTime: {
    fontSize: 12,
    fontWeight: '700',
    color: '#2D3748',
    width: 45,
  },
  cameraIsland: {
    width: 72,
    height: 18,
    backgroundColor: '#1A202C',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cameraLens: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#2D3748',
  },
  statusIcons: {
    flexDirection: 'row',
    alignItems: 'center',
    width: 45,
    justifyContent: 'flex-end',
  },
  screenContent: {
    flex: 1,
    width: '100%',
  },
  homeIndicatorContainer: {
    height: 18,
    backgroundColor: nintendoTheme.colors.cardBackground,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20,
  },
  homeIndicator: {
    width: 110,
    height: 4,
    backgroundColor: '#A0AEC0',
    borderRadius: 2,
  },
});
