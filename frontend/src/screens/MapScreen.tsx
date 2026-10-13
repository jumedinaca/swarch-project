import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { useMessages } from '../context/MessagesContext';
import { useNetwork } from '../context/NetworkContext';
import { GeoMessage, LocationCoords, MessageStatus, RangeDistance } from '../types';
import { nintendoTheme } from '../theme/nintendoTheme';
import { MapLibreOsmView, MapLibreOsmViewRef } from '../components/map/MapLibreOsmView';
import { RangeConfigModal } from '../components/map/RangeConfigModal';
import { CreateMessageModal } from '../components/messages/CreateMessageModal';
import { MessageDetailModal } from '../components/messages/MessageDetailModal';
import { NetworkModal } from '../components/network/NetworkModal';
import { PictoChatCard } from '../components/common/PictoChatCard';
import { calculateDistanceMeters } from '../utils/geoUtils';

interface MapScreenProps {
  onLogout: () => void;
}

// Coordenadas predeterminadas (Plaza Central / Campus) para pruebas o si no hay GPS disponible
const DEFAULT_COORDS: LocationCoords = {
  latitude: 4.6382,
  longitude: -74.0841,
};

export const MapScreen: React.FC<MapScreenProps> = ({ onLogout }) => {
  const { user } = useAuth();
  const {
    activeMessages,
    selectedMessage,
    setSelectedMessage,
    statusFilter,
    setStatusFilter,
    setSearchCenter,
  } = useMessages();
  const { pendingCount } = useNetwork();

  const mapViewRef = useRef<MapLibreOsmViewRef>(null);

  const [userLocation, setUserLocation] = useState<LocationCoords>(DEFAULT_COORDS);
  const [rangeDistance, setRangeDistance] = useState<RangeDistance>(300);
  const [rangeModalVisible, setRangeModalVisible] = useState(false);
  const [networkModalVisible, setNetworkModalVisible] = useState(false);
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[] | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [targetComposeCoords, setTargetComposeCoords] = useState<LocationCoords>(DEFAULT_COORDS);
  const [bottomListExpanded, setBottomListExpanded] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  // Mensajes dentro del rango activo
  const inRangeMessages = useMemo(() => {
    if (!visibleMessageIds) {
      return activeMessages.filter(
        (m) =>
          calculateDistanceMeters(
            userLocation.latitude,
            userLocation.longitude,
            m.latitude,
            m.longitude
          ) <= rangeDistance
      );
    }
    return activeMessages.filter((m) => visibleMessageIds.includes(m.id));
  }, [activeMessages, visibleMessageIds, userLocation, rangeDistance]);

  // Los mensajes se consultan alrededor de la ubicación actual del usuario
  useEffect(() => {
    setSearchCenter(userLocation);
  }, [userLocation, setSearchCenter]);

  // Función robusta para solicitar y obtener la ubicación GPS real del dispositivo
  const requestCurrentLocation = useCallback(async (): Promise<LocationCoords | null> => {
    // 1. En entorno Web, usar la API nativa de geolocalización del navegador
    if (Platform.OS === 'web') {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return null;
      const getWebPosition = (options: PositionOptions) =>
        new Promise<LocationCoords | null>((resolve) => {
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }),
            (err) => {
              console.warn('navigator.geolocation error:', err.code, err.message);
              resolve(null);
            },
            options
          );
        });
      // Primero rápida (red/WiFi, admite caché), luego alta precisión como respaldo
      return (
        (await getWebPosition({ enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 })) ||
        (await getWebPosition({ enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }))
      );
    }

    // 2. En entorno nativo móvil con expo-location
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return null;
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        return { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      } catch {
        // Respaldo: última posición conocida del dispositivo
        const last = await Location.getLastKnownPositionAsync();
        if (last) return { latitude: last.coords.latitude, longitude: last.coords.longitude };
      }
    } catch (err) {
      console.warn('Error en expo-location:', err);
    }

    return null;
  }, []);

  // Manejador del botón GPS para ubicar y recentrar al usuario
  const handleLocateUser = async () => {
    // Respuesta inmediata: volver a la última ubicación conocida mientras llega el GPS
    mapViewRef.current?.recenter(userLocation);
    setIsLocating(true);
    try {
      const coords = await requestCurrentLocation();
      if (coords) {
        setUserLocation(coords);
        setTargetComposeCoords(coords);
        setSearchCenter(coords);
        mapViewRef.current?.recenter(coords);
      } else {
        const msg =
          Platform.OS === 'web'
            ? 'No se pudo obtener tu ubicación. Permite el acceso a la ubicación en el navegador (requiere localhost o HTTPS).'
            : 'No se pudo acceder al GPS. Revisa que los permisos de ubicación estén habilitados.';
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.alert) {
          window.alert(msg);
        } else {
          Alert.alert('Ubicación GPS', msg);
        }
      }
    } catch (e) {
      console.warn('Error en handleLocateUser:', e);
    } finally {
      setIsLocating(false);
    }
  };

  // Obtener geolocalización al montar la pantalla
  useEffect(() => {
    (async () => {
      const coords = await requestCurrentLocation();
      if (coords) {
        setUserLocation(coords);
        setTargetComposeCoords(coords);
        setSearchCenter(coords);
        mapViewRef.current?.recenter(coords);
      }
    })();
  }, [requestCurrentLocation, setSearchCenter]);

  const handleOpenCreateModal = () => {
    setTargetComposeCoords(userLocation);
    setCreateModalVisible(true);
  };

  const handleSelectMessage = (msg: GeoMessage) => {
    setSelectedMessage(msg);
  };

  const filters: (MessageStatus | 'todos')[] = ['todos', 'publicado', 'pendiente', 'oculto'];

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        {/* Barra superior estilo HUD Nintendo */}
        <View style={styles.topBar}>
          {/* Perfil del explorador activo (sin etiqueta ONLINE) */}
          <View style={styles.userProfileSection}>
            <View style={[styles.userAvatar, { borderColor: user?.color || nintendoTheme.colors.wiiBlue }]}>
              <View style={[styles.userAvatarInner, { backgroundColor: user?.color || nintendoTheme.colors.wiiBlue }]}>
                <Text style={styles.userAvatarLetter}>
                  {user?.username.charAt(0).toUpperCase() || 'M'}
                </Text>
              </View>
            </View>
            <View>
              <Text style={styles.userNameText} numberOfLines={1}>
                {user?.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : '@invitado'}
              </Text>
            </View>
          </View>

          {/* Grupo de acciones del HUD: Red, Radar y Salir */}
          <View style={styles.topBarActions}>
            {/* Botón de Red Social / Amigos */}
            <TouchableOpacity
              style={styles.actionPill}
              onPress={() => setNetworkModalVisible(true)}
              activeOpacity={0.7}
              accessibilityLabel="Red Social y Amigos"
            >
              <Ionicons name="people-outline" size={14} color={nintendoTheme.colors.textPrimary} />
              <Text style={styles.actionPillText}>RED</Text>
              {pendingCount > 0 && (
                <View style={styles.networkBadge}>
                  <Text style={styles.networkBadgeText}>{pendingCount}</Text>
                </View>
              )}
            </TouchableOpacity>

            {/* Selector de Rango Radar */}
            <TouchableOpacity
              style={[styles.actionPill, styles.rangePill]}
              onPress={() => setRangeModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="radio-outline" size={13} color={nintendoTheme.colors.textPrimary} />
              <Text style={styles.actionPillText}>{rangeDistance}m</Text>
            </TouchableOpacity>

            {/* Botón de Salir / Cerrar Sesión */}
            <TouchableOpacity
              style={styles.iconActionBtn}
              onPress={onLogout}
              activeOpacity={0.7}
              accessibilityLabel="Cerrar Sesión"
            >
              <Ionicons name="log-out-outline" size={15} color={nintendoTheme.colors.famicomRed} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Barra de Filtros Segmentada Bento */}
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {filters.map((f) => {
              const isActive = statusFilter === f;
              const label = f === 'todos' ? 'TODOS' : f.toUpperCase();
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterChip,
                    isActive && styles.filterChipActive,
                  ]}
                  onPress={() => setStatusFilter(f)}
                  activeOpacity={0.75}
                >
                  <Text
                    style={[
                      styles.filterChipText,
                      isActive && styles.filterChipTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Contenedor del Mapa 3D */}
        <View style={styles.mapContainer}>
          <MapLibreOsmView
            ref={mapViewRef}
            userLocation={userLocation}
            messages={activeMessages}
            rangeDistance={rangeDistance}
            onSelectMessage={handleSelectMessage}
            onVisibleMessagesChange={setVisibleMessageIds}
            onLocateUser={handleLocateUser}
            isLocating={isLocating}
          />

          {/* Marcas de visor HUD en esquinas superiores */}
          <View style={styles.hudCornerTL} pointerEvents="none" />
          <View style={styles.hudCornerTR} pointerEvents="none" />
          <View style={styles.hudRadarTag} pointerEvents="none">
            <Text style={styles.hudRadarTagText}>MAPA ISO-3D // RADAR</Text>
          </View>

          {/* Botón Flotante de Acción: Escribir Nota */}
          <TouchableOpacity
            style={styles.composeFab}
            onPress={handleOpenCreateModal}
            activeOpacity={0.8}
          >
            <View style={styles.composeFabIconBox}>
              <Ionicons name="pencil" size={15} color="#FFFFFF" />
            </View>
            <Text style={styles.composeFabLabel}>NUEVA NOTA</Text>
          </TouchableOpacity>
        </View>

        {/* Cajón inferior de notas tipo PictoChat Feed */}
        <View style={[styles.bottomSheet, bottomListExpanded && styles.bottomSheetExpanded]}>
          <TouchableOpacity
            style={styles.sheetHandleArea}
            onPress={() => setBottomListExpanded((prev) => !prev)}
            activeOpacity={0.8}
          >
            <View style={styles.sheetHandleBar} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <Ionicons name="chatbubbles-outline" size={15} color={nintendoTheme.colors.textPrimary} />
                <Text style={styles.sheetTitle}>
                  NOTAS EN EL ÁREA [{inRangeMessages.length}]
                </Text>
              </View>
              <View style={styles.sheetToggleTag}>
                <Text style={styles.sheetToggleText}>
                  {bottomListExpanded ? 'MINIMIZAR' : 'VER LISTA'}
                </Text>
                <Ionicons
                  name={bottomListExpanded ? 'chevron-down' : 'chevron-up'}
                  size={14}
                  color={nintendoTheme.colors.textSecondary}
                />
              </View>
            </View>
          </TouchableOpacity>

          {bottomListExpanded && (
            <ScrollView
              style={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {inRangeMessages.length === 0 ? (
                <View style={styles.emptyContainer}>
                  <Text style={styles.emptyText}>
                    [ RADAR: NO HAY NOTAS A MENOS DE {rangeDistance}m ]
                  </Text>
                </View>
              ) : (
                inRangeMessages.map((msg) => (
                  <PictoChatCard
                    key={msg.id}
                    message={msg}
                    onPress={() => handleSelectMessage(msg)}
                    showDeleteAction={true}
                  />
                ))
              )}
            </ScrollView>
          )}
        </View>

        {/* Modales modulares de la aplicación */}
        <CreateMessageModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          targetCoords={targetComposeCoords}
        />

        <MessageDetailModal
          message={selectedMessage}
          visible={!!selectedMessage}
          onClose={() => setSelectedMessage(null)}
        />

        <RangeConfigModal
          visible={rangeModalVisible}
          onClose={() => setRangeModalVisible(false)}
          currentRange={rangeDistance}
          onSelectRange={setRangeDistance}
        />

        <NetworkModal
          visible={networkModalVisible}
          onClose={() => setNetworkModalVisible(false)}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FAF9F6',
  },
  container: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#FAF9F6',
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
    zIndex: 10,
  },
  userProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userAvatar: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1.5,
    padding: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  userAvatarLetter: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  userNameText: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    paddingVertical: 4,
    paddingHorizontal: 7,
    borderRadius: nintendoTheme.borderRadius.xs,
    gap: 4,
    position: 'relative',
  },
  actionPillText: {
    fontSize: 10,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  rangePill: {
    backgroundColor: '#FAF9F6',
  },
  networkBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    backgroundColor: nintendoTheme.colors.famicomRed,
    borderRadius: 6,
    minWidth: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 2,
    borderWidth: 1,
    borderColor: '#FFFFFF',
  },
  networkBadgeText: {
    color: '#FFFFFF',
    fontSize: 8,
    fontWeight: '800',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  iconActionBtn: {
    width: 28,
    height: 28,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderMedium,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    backgroundColor: '#ECEAE3',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: nintendoTheme.colors.borderMedium,
  },
  filterScroll: {
    paddingHorizontal: 12,
    gap: 6,
  },
  filterChip: {
    paddingVertical: 4,
    paddingHorizontal: 9,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    borderWidth: 1,
    borderColor: '#D4D0C6',
  },
  filterChipActive: {
    backgroundColor: nintendoTheme.colors.retroDpad,
    borderColor: '#111315',
  },
  filterChipText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  hudCornerTL: {
    position: 'absolute',
    top: 10,
    left: 10,
    width: 14,
    height: 14,
    borderLeftWidth: 2,
    borderTopWidth: 2,
    borderColor: '#24272A',
    opacity: 0.6,
  },
  hudCornerTR: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 14,
    height: 14,
    borderRightWidth: 2,
    borderTopWidth: 2,
    borderColor: '#24272A',
    opacity: 0.6,
  },
  hudRadarTag: {
    position: 'absolute',
    top: 10,
    left: 28,
    backgroundColor: 'rgba(250, 249, 246, 0.88)',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#D4D0C6',
  },
  hudRadarTagText: {
    fontSize: 8,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    letterSpacing: 0.5,
  },
  composeFab: {
    position: 'absolute',
    bottom: 16,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: nintendoTheme.colors.miiverseGreen,
    borderRadius: nintendoTheme.borderRadius.sm,
    paddingVertical: 7,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1.5,
    borderColor: '#1C4633',
    borderBottomWidth: 3,
    zIndex: 35,
  },
  composeFabIconBox: {
    width: 20,
    height: 20,
    borderRadius: 2,
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeFabLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 1.5,
    borderColor: nintendoTheme.colors.borderMedium,
    paddingHorizontal: 12,
    paddingTop: 6,
    maxHeight: 52,
    ...nintendoTheme.shadows.pictoCard,
  },
  bottomSheetExpanded: {
    maxHeight: 260,
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  sheetHandleBar: {
    width: 32,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#CCC8BC',
    marginBottom: 6,
  },
  sheetHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },
  sheetTitleGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  sheetTitle: {
    fontSize: 11,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  sheetToggleTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FAF9F6',
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#E2DFD8',
  },
  sheetToggleText: {
    fontSize: 9,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  sheetScroll: {
    marginTop: 6,
  },
  emptyContainer: {
    padding: 18,
    alignItems: 'center',
  },
  emptyText: {
    color: nintendoTheme.colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
