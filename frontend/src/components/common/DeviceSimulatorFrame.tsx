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

  // Dimensiones simuladas de consola Nintendo DS (pantalla táctil)
  const dsWidth = 420;
  const dsHeight = Math.min(height - 40, 840);

  return (
    <View style={styles.desktopBackdrop}>
      {/* Barra de control del simulador de escritorio */}
      <View style={[styles.desktopToolbar, { width: dsWidth }]}>
        <View style={styles.toolbarBadge}>
          <Ionicons name="chatbubbles" size={14} color={nintendoTheme.colors.roomA} />
          <Text style={styles.toolbarText}>Nintendo DS • PictoChat</Text>
        </View>

        <TouchableOpacity
          style={styles.expandButton}
          onPress={() => setForceFullWidth(true)}
          activeOpacity={0.8}
        >
          <Ionicons name="expand-outline" size={14} color={nintendoTheme.colors.textSecondary} />
          <Text style={styles.expandButtonText}>Pantalla Completa</Text>
        </TouchableOpacity>
      </View>

      {/* Carcasa física de consola Nintendo DS Lite / DSi */}
      <View style={[styles.dsBezel, { width: dsWidth, height: dsHeight }]}>
        {/* Bisagra superior con altavoces estéreo y LED de estado DS */}
        <View style={styles.dsTopHinge}>
          {/* Rejilla de altavoz izquierdo */}
          <View style={styles.speakerGrid}>
            <View style={styles.speakerHole} />
            <View style={styles.speakerHole} />
            <View style={styles.speakerHole} />
            <View style={styles.speakerHole} />
          </View>

          {/* Logotipo de bisagra PictoChat */}
          <View style={styles.hingeBrand}>
            <View style={styles.hingeLine} />
            <Text style={styles.hingeText}>NINTENDO DS</Text>
            <View style={styles.hingeLine} />
          </View>

          {/* LED de alimentación y estado inalámbrico */}
          <View style={styles.ledCluster}>
            <View style={styles.ledWirelessActive} />
            <View style={styles.ledPower} />
          </View>
        </View>

        {/* Marco de la pantalla táctil de la consola */}
        <View style={styles.screenBezelBorder}>
          {/* Barra de estado superior del sistema Nintendo DS */}
          <View style={styles.dsStatusBar}>
            {/* Señal inalámbrica Nintendo DS Wireless */}
            <View style={styles.wirelessSignalGroup}>
              <View style={[styles.signalBar, styles.signalBar1]} />
              <View style={[styles.signalBar, styles.signalBar2]} />
              <View style={[styles.signalBar, styles.signalBar3]} />
              <Text style={styles.wirelessText}>DS WIRELESS</Text>
            </View>

            {/* Reloj digital Nintendo DS */}
            <Text style={styles.dsClockText}>12:30</Text>

            {/* Icono de batería de Nintendo DS */}
            <View style={styles.dsBatteryGroup}>
              <View style={styles.dsBatteryBody}>
                <View style={styles.dsBatteryBar} />
                <View style={styles.dsBatteryBar} />
                <View style={styles.dsBatteryBar} />
              </View>
              <View style={styles.dsBatteryCap} />
            </View>
          </View>

          {/* Contenido interactivo de la aplicación */}
          <View style={styles.screenContent}>{children}</View>
        </View>

        {/* Borde inferior de la consola DS con micrófono y acento de stylus */}
        <View style={styles.dsBottomBezel}>
          <View style={styles.micHole} />
          <Text style={styles.dsSubText}>TOUCH SCREEN</Text>
          <View style={styles.stylusSlotHint} />
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
    backgroundColor: '#DDE5E0', // Fondo de escritorio neutro y tenue
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  desktopToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 4,
  },
  toolbarBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#BAC7C1',
    gap: 6,
    ...nintendoTheme.shadows.wiiSoft,
  },
  toolbarText: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.3,
  },
  expandButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#BAC7C1',
    gap: 6,
  },
  expandButtonText: {
    fontSize: 11,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
  },
  dsBezel: {
    backgroundColor: '#202629', // Carcasa grafito oscuro DS
    borderRadius: 24,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    shadowColor: '#0E1714',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 14,
    borderWidth: 2,
    borderColor: '#374146',
    flexDirection: 'column',
  },
  dsTopHinge: {
    height: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    marginBottom: 4,
  },
  speakerGrid: {
    flexDirection: 'row',
    gap: 3,
  },
  speakerHole: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#121618',
  },
  hingeBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hingeLine: {
    width: 20,
    height: 1,
    backgroundColor: '#374146',
  },
  hingeText: {
    fontSize: 9.5,
    fontWeight: '900',
    letterSpacing: 1.5,
    color: '#8A979E',
  },
  ledCluster: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  ledWirelessActive: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#E8A725', // LED amarillo/ámbar de señal Wi-Fi DS
  },
  ledPower: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#2CD96B', // LED verde de encendido DS con brillo
    shadowColor: '#2CD96B',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  screenBezelBorder: {
    flex: 1,
    backgroundColor: '#161B1E',
    borderRadius: 10,
    borderWidth: 2,
    borderColor: '#111517',
    overflow: 'hidden',
  },
  dsStatusBar: {
    height: 26,
    backgroundColor: '#DDE6E1', // Barra superior estilo sistema DS
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    borderBottomWidth: 1.5,
    borderBottomColor: '#242D30',
    zIndex: 20,
  },
  wirelessSignalGroup: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 2,
  },
  signalBar: {
    width: 3,
    backgroundColor: '#1DB954',
    borderRadius: 1,
  },
  signalBar1: { height: 4 },
  signalBar2: { height: 7 },
  signalBar3: { height: 10 },
  wirelessText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: '#28363A',
    marginLeft: 4,
    letterSpacing: 0.5,
  },
  dsClockText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#1E2528',
    fontVariant: ['tabular-nums'],
  },
  dsBatteryGroup: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dsBatteryBody: {
    flexDirection: 'row',
    gap: 1.5,
    padding: 1.5,
    borderWidth: 1.5,
    borderColor: '#242D30',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  dsBatteryBar: {
    width: 3.5,
    height: 7,
    backgroundColor: '#25A244',
  },
  dsBatteryCap: {
    width: 1.5,
    height: 4,
    backgroundColor: '#242D30',
    borderTopRightRadius: 1,
    borderBottomRightRadius: 1,
  },
  screenContent: {
    flex: 1,
    width: '100%',
    backgroundColor: nintendoTheme.colors.background,
  },
  dsBottomBezel: {
    height: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 3,
  },
  micHole: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#121618',
  },
  dsSubText: {
    fontSize: 8,
    fontWeight: '800',
    color: '#65747A',
    letterSpacing: 1.2,
  },
  stylusSlotHint: {
    width: 12,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#121618',
  },
});

