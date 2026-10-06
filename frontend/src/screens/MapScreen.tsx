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
        {/* Barra superior estilo Menú Wii / Plaza Mii */}
        <View style={styles.topBar}>
          {/* Perfil del usuario activo */}
          <View style={styles.userProfileSection}>
            <View style={[styles.userAvatar, { backgroundColor: user?.color || nintendoTheme.colors.wiiBlue }]}>
              <Text style={styles.userAvatarLetter}>
                {user?.username.charAt(0).toUpperCase() || 'M'}
              </Text>
            </View>
            <View>
              <Text style={styles.userNameText} numberOfLines={1}>
                {user?.username ? (user.username.startsWith('@') ? user.username : `@${user.username}`) : '@Invitado'}
              </Text>
            </View>
          </View>

          {/* Grupo de acciones de la barra superior: Recargar, Configuración de Rango y Salir */}
          <View style={styles.topBarActions}>
            <TouchableOpacity
              style={styles.refreshButton}
              onPress={refreshMessages}
              activeOpacity={0.7}
              disabled={isRefreshingMessages}
            >
              <Ionicons
                name="refresh-outline"
                size={16}
                color={isRefreshingMessages ? nintendoTheme.colors.textMuted : nintendoTheme.colors.wiiBlue}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.rangeButton}
              onPress={() => setRangeModalVisible(true)}
              activeOpacity={0.7}
            >
              <Ionicons name="radio-outline" size={15} color={nintendoTheme.colors.wiiBlue} />
              <Text style={styles.rangeButtonText}>{rangeDistance}m</Text>
            </TouchableOpacity>

            {/* Botón de salir / cerrar sesión */}
            <TouchableOpacity
              style={styles.exitButton}
              onPress={onLogout}
              activeOpacity={0.7}
            >
              <Ionicons name="log-out-outline" size={16} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Barra horizontal de filtros de estado estilo píldora Nintendo */}
        <View style={styles.filterBar}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterScroll}
          >
            {filters.map((f) => {
              const isActive = statusFilter === f;
              const label = f === 'todos' ? 'Todos los mensajes' : f.charAt(0).toUpperCase() + f.slice(1);
              return (
                <TouchableOpacity
                  key={f}
                  style={[
                    styles.filterPill,
                    isActive && styles.filterPillActive,
                  ]}
                  onPress={() => setStatusFilter(f)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.filterPillText,
                      isActive && styles.filterPillTextActive,
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

          {/* Botón Flotante de Acción (FAB) con forma de Stylus PictoChat ubicado en la esquina inferior izquierda */}
          <TouchableOpacity
            style={styles.composeFab}
            onPress={handleOpenCreateModal}
            activeOpacity={0.85}
          >
            <View style={styles.composeFabInner}>
              <Ionicons name="pencil" size={22} color="#FFFFFF" />
            </View>
            <Text style={styles.composeFabLabel}>Escribir Nota</Text>
          </TouchableOpacity>
        </View>

        {/* Cajón inferior de notas contextuales estilo feed PictoChat */}
        <View style={[styles.bottomSheet, bottomListExpanded && styles.bottomSheetExpanded]}>
          <TouchableOpacity
            style={styles.sheetHandleArea}
            onPress={() => setBottomListExpanded((prev) => !prev)}
            activeOpacity={0.8}
          >
            <View style={styles.sheetHandleBar} />
            <View style={styles.sheetHeaderRow}>
              <View style={styles.sheetTitleGroup}>
                <Ionicons name="newspaper-outline" size={16} color={nintendoTheme.colors.wiiBlue} />
                <Text style={styles.sheetTitle}>
                  Notas en el Área ({inRangeMessages.length})
                </Text>
              </View>
              <Ionicons
                name={bottomListExpanded ? 'chevron-down' : 'chevron-up'}
                size={18}
                color={nintendoTheme.colors.textSecondary}
              />
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
                  <Text style={styles.emptyText}>No hay notas dentro del rango ({rangeDistance}m).</Text>
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
    backgroundColor: '#FFFFFF',
  },
  container: {
    flex: 1,
    backgroundColor: nintendoTheme.colors.background,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F0',
    ...nintendoTheme.shadows.wiiSoft,
    zIndex: 10,
  },
  userProfileSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  userAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  userAvatarLetter: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 15,
  },
  userNameText: {
    fontSize: 14,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  rangeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#EBF6FC',
    borderWidth: 1.5,
    borderColor: '#BAE3F7',
    paddingVertical: 5,
    paddingHorizontal: 11,
    borderRadius: nintendoTheme.borderRadius.pill,
  },
  rangeButtonText: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.wiiBlue,
  },
  refreshButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#EBF6FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F2F6F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterBar: {
    backgroundColor: '#F8FAF9',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E6ECE9',
  },
  filterScroll: {
    paddingHorizontal: 14,
    gap: 8,
  },
  filterPill: {
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: nintendoTheme.borderRadius.pill,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#D4E0DC',
  },
  filterPillActive: {
    backgroundColor: nintendoTheme.colors.mintSoft,
    borderColor: nintendoTheme.colors.miiverseGreen,
  },
  filterPillText: {
    fontSize: 12,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '600',
  },
  filterPillTextActive: {
    color: '#15803D',
    fontWeight: '700',
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  composeFab: {
    position: 'absolute',
    bottom: 20,
    left: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: nintendoTheme.colors.miiverseGreen,
    borderRadius: nintendoTheme.borderRadius.pill,
    paddingVertical: 8,
    paddingHorizontal: 16,
    gap: 8,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#1A332B',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 6,
    zIndex: 35,
  },
  composeFabInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composeFabLabel: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 14,
    letterSpacing: 0.2,
  },
  bottomSheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1.5,
    borderBottomWidth: 0,
    borderColor: '#D4DFDB',
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: 70,
    ...nintendoTheme.shadows.pictoCard,
  },
  bottomSheetExpanded: {
    maxHeight: 260,
  },
  sheetHandleArea: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  sheetHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#CBD5E1',
    marginBottom: 8,
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
    fontSize: 13,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  sheetScroll: {
    marginTop: 8,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: nintendoTheme.colors.textMuted,
    fontSize: 13,
  },
});
