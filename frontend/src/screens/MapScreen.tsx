import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useAuth } from '../context/AuthContext';
import { useMessages } from '../context/MessagesContext';
import { GeoMessage, LocationCoords, MessageStatus, RangeDistance } from '../types';
import { nintendoTheme } from '../theme/nintendoTheme';
import { MapLibreOsmView } from '../components/map/MapLibreOsmView';
import { RangeConfigModal } from '../components/map/RangeConfigModal';
import { CreateMessageModal } from '../components/messages/CreateMessageModal';
import { MessageDetailModal } from '../components/messages/MessageDetailModal';
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
    messages,
    activeMessages,
    selectedMessage,
    setSelectedMessage,
    statusFilter,
    setStatusFilter,
    refreshMessages,
    isLoading: isRefreshingMessages,
  } = useMessages();

  const [userLocation, setUserLocation] = useState<LocationCoords>(DEFAULT_COORDS);
  const [rangeDistance, setRangeDistance] = useState<RangeDistance>(300);
  const [rangeModalVisible, setRangeModalVisible] = useState(false);
  const [visibleMessageIds, setVisibleMessageIds] = useState<string[] | null>(null);
  const [createModalVisible, setCreateModalVisible] = useState(false);
  const [targetComposeCoords, setTargetComposeCoords] = useState<LocationCoords>(DEFAULT_COORDS);
  const [bottomListExpanded, setBottomListExpanded] = useState(false);

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

  // Obtener geolocalización del dispositivo
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          const coords = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
          };
          setUserLocation(coords);
          setTargetComposeCoords(coords);
        }
      } catch (err) {
        // En navegadores o entornos sin permiso, usamos coordenadas predeterminadas
        console.log('Usando coordenadas predeterminadas de simulación');
      }
    })();
  }, []);

  // Solo se puede crear una nota presionando el botón FAB, vinculada a la ubicación actual
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
        {/* Barra superior estilo Consola Nintendo DS PictoChat */}
        <View style={styles.topBar}>
          {/* Perfil del usuario activo estilo Placa de Nombre PictoChat */}
          <View style={styles.userProfileSection}>
            <View style={[styles.userAvatar, { backgroundColor: user?.color || nintendoTheme.colors.roomA }]}>
              <Text style={styles.userAvatarLetter}>
                {user?.username.charAt(0).toUpperCase() || 'P'}
              </Text>
            </View>
            <View>
              <Text style={styles.userNameText} numberOfLines={1}>
                {user?.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : '@Invitado'}
              </Text>
              <View style={styles.userStatusRow}>
                <View style={styles.userOnlineDot} />
                <Text style={styles.userStatusSubtext}>DS WIRELESS ON</Text>
              </View>
            </View>
          </View>

          {/* Grupo de acciones de la barra superior: Recargar, Radar/Rango y Salir */}
          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.actionSquareBtn}
              onPress={refreshMessages}
              activeOpacity={0.7}
              disabled={isRefreshingMessages}
            >
              <Ionicons
                name="refresh"
                size={15}
                color={isRefreshingMessages ? nintendoTheme.colors.textMuted : nintendoTheme.colors.textPrimary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rangeButton}
              onPress={() => setRangeModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="radio" size={13} color={nintendoTheme.colors.roomA} />
              <Text style={styles.rangeButtonText}>{rangeDistance}m</Text>
            </TouchableOpacity>

            {/* Botón de salir / cerrar sesión */}
            <TouchableOpacity
              style={[styles.actionSquareBtn, styles.exitBtn]}
              onPress={onLogout}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out" size={15} color="#D43247" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Barra horizontal de filtros estilo Selector de Salas PictoChat */}
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {filters.map((f) => {
              const isActive = statusFilter === f;
              let roomColor = nintendoTheme.colors.textSecondary;
              let roomTag = 'TODO';
              let label = 'Todos';

              if (f === 'publicado') {
                roomColor = nintendoTheme.colors.roomA;
                roomTag = 'SALA A';
                label = 'Publicados';
              } else if (f === 'pendiente') {
                roomColor = nintendoTheme.colors.roomC;
                roomTag = 'SALA B';
                label = 'Pendientes';
              } else if (f === 'oculto') {
                roomColor = nintendoTheme.colors.roomB;
                roomTag = 'SALA C';
                label = 'Ocultos';
              }

              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterTab,
                    isActive && styles.filterTabActive,
                    isActive && { borderColor: nintendoTheme.colors.pictoBorder },
                  ]}
                  onPress={() => setStatusFilter(f)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.filterRoomBadge, { backgroundColor: isActive ? roomColor : '#DCE5E0' }]}>
                    <Text style={[styles.filterRoomTag, isActive && { color: '#FFFFFF' }]}>
                      {roomTag}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.filterTabText,
                      isActive && styles.filterTabTextActive,
                    ]}
                  >
                    {label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Mapa Isométrico 3D MapLibre con OpenStreetMap */}
        <View style={styles.mapContainer}>
          <MapLibreOsmView
            userLocation={userLocation}
            messages={activeMessages}
            rangeDistance={rangeDistance}
            onSelectMessage={handleSelectMessage}
            onVisibleMessagesChange={setVisibleMessageIds}
          />

          {/* Botón Flotante de Acción (FAB) estilo Stylus / Lápiz táctil PictoChat DS */}
          <TouchableOpacity
            style={styles.composeFab}
            onPress={handleOpenCreateModal}
            activeOpacity={0.8}
          >
            <View style={styles.composeFabInner}>
              <Ionicons name="pencil" size={17} color="#FFFFFF" />
            </View>
            <Text style={styles.composeFabLabel}>ESCRIBIR NOTA</Text>
          </TouchableOpacity>
        </View>

        {/* Cajón inferior de notas contextuales estilo buzón PictoChat */}
        <View style={[styles.bottomSheet, bottomListExpanded && styles.bottomSheetExpanded]}>
          <TouchableOpacity
            style={styles.sheetHandleArea}
            onPress={() => setBottomListExpanded((prev) => !prev)}
            activeOpacity={0.8}
          >
            <View style={styles.sheetHandleBar} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <Ionicons name="chatbubbles" size={15} color={nintendoTheme.colors.roomA} />
                <Text style={styles.sheetTitle}>
                  NOTAS EN EL ÁREA [{inRangeMessages.length}]
                </Text>
              </View>
              <View style={styles.sheetChevronBox}>
                <Ionicons
                  name={bottomListExpanded ? 'chevron-down' : 'chevron-up'}
                  size={15}
                  color={nintendoTheme.colors.textPrimary}
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
                  <Ionicons name="radio-outline" size={24} color={nintendoTheme.colors.textSecondary} style={{ marginBottom: 6 }} />
                  <Text style={styles.emptyText}>No hay notas dentro del alcance de transmisión ({rangeDistance}m).</Text>
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

        {/* Modal de Creación de Mensaje (140 caracteres) */}
        <CreateMessageModal
          visible={createModalVisible}
          onClose={() => setCreateModalVisible(false)}
          targetCoords={targetComposeCoords}
        />

        {/* Modal de Detalle de Mensaje */}
        <MessageDetailModal
          message={selectedMessage}
          visible={!!selectedMessage}
          onClose={() => setSelectedMessage(null)}
        />

        {/* Modal de Configuración de Rango de Mensajes */}
        <RangeConfigModal
          visible={rangeModalVisible}
          onClose={() => setRangeModalVisible(false)}
          currentRange={rangeDistance}
          onSelectRange={setRangeDistance}
        />
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#DCE5E0',
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
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
    ...nintendoTheme.shadows.wiiSoft,
    zIndex: 10,
  },
  userProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: nintendoTheme.borderRadius.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
  },
  userAvatarLetter: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 14,
  },
  userNameText: {
    fontSize: 13,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.3,
  },
  userStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  userOnlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: nintendoTheme.colors.dsWirelessGreen,
  },
  userStatusSubtext: {
    fontSize: 8.5,
    fontWeight: '800',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  actionSquareBtn: {
    width: 32,
    height: 32,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#F3F8F5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    borderBottomWidth: 2.5,
  },
  exitBtn: {
    backgroundColor: '#FDF1F1',
    borderColor: '#9C1A2B',
  },
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#EBF6FC',
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    borderBottomWidth: 2.5,
    paddingVertical: 5,
    paddingHorizontal: 9,
    borderRadius: nintendoTheme.borderRadius.xs,
  },
  rangeButtonText: {
    fontSize: 11,
    fontWeight: '900',
    color: nintendoTheme.colors.roomA,
    letterSpacing: 0.3,
    fontVariant: ['tabular-nums'],
  },
  filterBar: {
    backgroundColor: '#E5EFE9',
    paddingVertical: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
  },
  filterScroll: {
    paddingHorizontal: 10,
    gap: 6,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAFDFB',
    borderWidth: 1.5,
    borderColor: '#BAC7C1',
    gap: 5,
  },
  filterTabActive: {
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 2.5,
    ...nintendoTheme.shadows.wiiSoft,
  },
  filterRoomBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 2,
  },
  filterRoomTag: {
    fontSize: 8.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textSecondary,
    letterSpacing: 0.5,
  },
  filterTabText: {
    fontSize: 11,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
  },
  filterTabTextActive: {
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '900',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  composeFab: {
    position: 'absolute',
    bottom: 16,
    left: 14,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: nintendoTheme.colors.roomB,
    borderRadius: nintendoTheme.borderRadius.xs,
    paddingVertical: 8,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    borderBottomWidth: 3,
    borderBottomColor: '#144F23',
    ...nintendoTheme.shadows.dsTactile,
    zIndex: 35,
  },
  composeFabInner: {
    width: 24,
    height: 24,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeFabLabel: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 0.8,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: nintendoTheme.colors.pictoBorder,
    paddingHorizontal: 12,
    paddingTop: 6,
    maxHeight: 64,
    ...nintendoTheme.shadows.pictoCard,
  },
  bottomSheetExpanded: {
    maxHeight: 270,
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingBottom: 6,
  },
  sheetHandleBar: {
    width: 36,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#A8B7B0',
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
    fontSize: 11.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.5,
  },
  sheetChevronBox: {
    width: 22,
    height: 22,
    borderRadius: 3,
    backgroundColor: '#F0F6F3',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BAC7C1',
  },
  sheetScroll: {
    marginTop: 6,
  },
  emptyContainer: {
    padding: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: nintendoTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
});
