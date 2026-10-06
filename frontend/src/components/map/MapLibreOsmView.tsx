import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  StyleSheet,
  Platform,
  TouchableOpacity,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoMessage, LocationCoords, RangeDistance } from '../../types';
import { nintendoTheme } from '../../theme/nintendoTheme';

// WebView condicional para plataformas nativas
let WebViewComponent: any = null;
if (Platform.OS !== 'web') {
  try {
    WebViewComponent = require('react-native-webview').WebView;
  } catch (e) {
    console.warn('react-native-webview no disponible', e);
  }
}

interface MapLibreOsmViewProps {
  userLocation: LocationCoords;
  messages: GeoMessage[];
  rangeDistance: RangeDistance;
  onSelectMessage: (message: GeoMessage) => void;
  onVisibleMessagesChange?: (visibleIds: string[]) => void;
}

export const MapLibreOsmView: React.FC<MapLibreOsmViewProps> = ({
  userLocation,
  messages,
  rangeDistance,
  onSelectMessage,
  onVisibleMessagesChange,
}) => {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Generamos el HTML embebido de MapLibre con OpenStreetMap y perspectiva isométrica 3D
  const mapHtml = useMemo(() => {
    const messagesJson = JSON.stringify(messages);
    const userLat = userLocation.latitude;
    const userLng = userLocation.longitude;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>MapLibre OSM 3D</title>
  <link rel="stylesheet" href="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css" />
  <script src="https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #map {
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #e6f0ed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    
    /* Marcador del Usuario estilo radar DS */
    .user-marker {
      width: 26px;
      height: 26px;
      position: relative;
      cursor: pointer;
    }
    .user-marker-pulse {
      position: absolute;
      width: 44px;
      height: 44px;
      left: -9px;
      top: -9px;
      border-radius: 50%;
      background: rgba(26, 123, 185, 0.3);
      animation: pulse 2s infinite ease-out;
    }
    .user-marker-dot {
      position: absolute;
      width: 22px;
      height: 22px;
      left: 2px;
      top: 2px;
      border-radius: 4px;
      background: #1A7BB9;
      border: 2px solid #ffffff;
      box-shadow: 0 3px 8px rgba(20, 30, 35, 0.6);
      transform: rotate(45deg);
    }
    @keyframes pulse {
      0% { transform: scale(0.6); opacity: 0.9; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* Marcador 3D estilo Bocadillo PictoChat DS sobre el terreno */
    .billboard-marker {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      transform-style: preserve-3d;
      transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
    }
    .billboard-marker:hover, .billboard-marker:active {
      transform: translateY(-6px) scale(1.08);
    }
    .billboard-bubble {
      background: #ffffff;
      border-radius: 5px;
      border: 2px solid #242d30;
      padding: 5px 9px;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 6px 14px rgba(25, 35, 40, 0.3);
      position: relative;
      white-space: nowrap;
      max-width: 160px;
    }
    .billboard-bubble::after {
      content: '';
      position: absolute;
      bottom: -7px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 7px solid #242d30;
    }
    .billboard-avatar {
      width: 14px;
      height: 14px;
      border-radius: 2px;
      flex-shrink: 0;
      border: 1px solid rgba(0, 0, 0, 0.3);
    }
    .billboard-text {
      font-size: 11px;
      font-weight: 800;
      color: #1e2528;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: 0.2px;
    }
    /* Sombra 3D proyectada en el plano del suelo */
    .billboard-shadow {
      width: 20px;
      height: 6px;
      background: rgba(20, 28, 30, 0.35);
      border-radius: 50%;
      margin-top: 8px;
      filter: blur(1.5px);
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    const userCoords = [${userLng}, ${userLat}];
    let currentCenter = [${userLng}, ${userLat}];
    let currentRange = ${rangeDistance};
    let allMessages = ${messagesJson};
    let isMapLoaded = false;
    const markersMap = new Map();

    // Generador de círculo geodésico exacto en metros
    function getGeoJSONCircle(centerLng, centerLat, radiusMeters, points = 64) {
      const coords = [];
      const earthRadius = 6371000;
      const d = radiusMeters / earthRadius;
      const latRad = centerLat * Math.PI / 180;
      const lngRad = centerLng * Math.PI / 180;

      for (let i = 0; i <= points; i++) {
        const bearing = (i * 2 * Math.PI) / points;
        const pLat = Math.asin(
          Math.sin(latRad) * Math.cos(d) +
          Math.cos(latRad) * Math.sin(d) * Math.cos(bearing)
        );
        const pLng = lngRad + Math.atan2(
          Math.sin(bearing) * Math.sin(d) * Math.cos(latRad),
          Math.cos(d) - Math.sin(latRad) * Math.sin(pLat)
        );
        coords.push([pLng * 180 / Math.PI, pLat * 180 / Math.PI]);
      }

      return {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          geometry: {
            type: 'Polygon',
            coordinates: [coords]
          },
          properties: {}
        }]
      };
    }

    // Cálculo de distancia esférica (Haversine) en metros
    function getDistanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371000;
      const dLat = (lat2 - lat1) * Math.PI / 180;
      const dLon = (lon2 - lon1) * Math.PI / 180;
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }

    // Estilo vectorial abierto de OpenStreetMap con capas de extrusión 3D
    const osmVectorStyle = 'https://tiles.openfreemap.org/styles/liberty';

    // Inicializamos MapLibre con proyección 3D isométrica y cámara inclinada
    const map = new maplibregl.Map({
      container: 'map',
      style: osmVectorStyle,
      center: userCoords,
      zoom: 16.5,
      pitch: 62,          // Inclinación 3D pronunciada para apreciar volumen
      bearing: -20,       // Rotación isométrica diorama
      antialias: true,
      maxPitch: 85,
      attributionControl: false, // Desactivado en el mapa para evitar elementos invasivos
    });

    // Marcador del usuario actual (permanece en su posición real)
    const userEl = document.createElement('div');
    userEl.className = 'user-marker';
    userEl.innerHTML = '<div class="user-marker-pulse"></div><div class="user-marker-dot"></div>';
    new maplibregl.Marker({ element: userEl, anchor: 'center' })
      .setLngLat(userCoords)
      .addTo(map);

    function updateRangeCircle() {
      if (!isMapLoaded) return;
      const source = map.getSource('range-circle-source');
      if (source) {
        source.setData(getGeoJSONCircle(currentCenter[0], currentCenter[1], currentRange));
      }
    }

    function syncMessages(msgs) {
      allMessages = msgs;

      // Limpiar marcadores que ya no existan
      markersMap.forEach((entry, id) => {
        if (!allMessages.some(m => m.id === id)) {
          entry.marker.remove();
          markersMap.delete(id);
        }
      });

      allMessages.forEach(msg => {
        if (msg.status === 'eliminado') {
          if (markersMap.has(msg.id)) {
            markersMap.get(msg.id).marker.remove();
            markersMap.delete(msg.id);
          }
          return;
        }

        if (!markersMap.has(msg.id)) {
          const el = document.createElement('div');
          el.className = 'billboard-marker';
          el.innerHTML = \`
            <div class="billboard-bubble">
              <div class="billboard-avatar" style="background: \${msg.authorColor};"></div>
              <div class="billboard-text">\${msg.content.substring(0, 20)}\${msg.content.length > 20 ? '...' : ''}</div>
            </div>
            <div class="billboard-shadow"></div>
          \`;

          el.addEventListener('click', (e) => {
            e.stopPropagation();
            notifyParent({ type: 'SELECT_MESSAGE', id: msg.id });
          });

          const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
            .setLngLat([msg.longitude, msg.latitude]);

          markersMap.set(msg.id, { marker, msg, isVisible: false });
        } else {
          markersMap.get(msg.id).msg = msg;
        }
      });

      updateVisibility();
    }

    function updateVisibility() {
      const centerLng = currentCenter[0];
      const centerLat = currentCenter[1];
      const visibleIds = [];

      markersMap.forEach((entry, id) => {
        const msg = entry.msg;
        const dist = getDistanceMeters(centerLat, centerLng, msg.latitude, msg.longitude);
        const shouldBeVisible = dist <= currentRange;

        if (shouldBeVisible) {
          visibleIds.push(id);
          if (!entry.isVisible) {
            entry.marker.addTo(map);
            entry.isVisible = true;
          }
        } else {
          if (entry.isVisible) {
            entry.marker.remove();
            entry.isVisible = false;
          }
        }
      });

      notifyParent({
        type: 'VISIBLE_MESSAGES_CHANGED',
        ids: visibleIds
      });
    }

    // Movimiento del mapa (vista libre): actualiza el centro del radio en tiempo real
    map.on('move', () => {
      const c = map.getCenter();
      currentCenter = [c.lng, c.lat];
      updateRangeCircle();
      updateVisibility();
    });

    // Ajuste de iluminación, extrusión 3D y círculo de rango una vez cargado el estilo
    map.on('load', () => {
      isMapLoaded = true;

      // Capa de círculo de rango activo en el terreno
      map.addSource('range-circle-source', {
        type: 'geojson',
        data: getGeoJSONCircle(currentCenter[0], currentCenter[1], currentRange)
      });

      map.addLayer({
        id: 'range-circle-fill',
        type: 'fill',
        source: 'range-circle-source',
        paint: {
          'fill-color': '#1A7BB9',
          'fill-opacity': 0.12
        }
      });

      map.addLayer({
        id: 'range-circle-stroke',
        type: 'line',
        source: 'range-circle-source',
        paint: {
          'line-color': '#125C8E',
          'line-width': 2,
          'line-opacity': 0.9,
          'line-dasharray': [3, 2]
        }
      });

      // Luz direccional 3D para acentuar sombras y volumen
      map.setLight({
        anchor: 'viewport',
        color: '#ffffff',
        intensity: 0.65,
        position: [1.5, 210, 45]
      });

      // Si existe la capa de edificios 3D en el estilo de OSM, acentuamos su volumen
      if (map.getLayer('building-3d')) {
        map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.92);
        map.setPaintProperty('building-3d', 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['get', 'render_height'],
          0, '#dbeae4',
          40, '#c7ded7',
          120, '#a2ccc0'
        ]);
      } else if (map.getSource('openmaptiles') && !map.getLayer('custom-3d-buildings')) {
        map.addLayer({
          'id': 'custom-3d-buildings',
          'source': 'openmaptiles',
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 13,
          'paint': {
            'fill-extrusion-color': '#d3e4df',
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.88
          }
        });
      }

      // Sincronizar mensajes iniciales
      syncMessages(allMessages);
    });

    // Envío de eventos hacia React Native / Host Web
    function notifyParent(data) {
      const payload = JSON.stringify(data);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent) {
        window.parent.postMessage(payload, '*');
      }
    }

    // Escuchar mensajes entrantes desde React Native
    window.addEventListener('message', (event) => {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data.type === 'UPDATE_MESSAGES') {
          syncMessages(data.messages);
        } else if (data.type === 'SET_RANGE') {
          currentRange = data.radius;
          updateRangeCircle();
          updateVisibility();
        } else if (data.type === 'RECENTER') {
          map.flyTo({
            center: [data.longitude, data.latitude],
            zoom: 16.5,
            pitch: 62,
            bearing: -20,
            essential: true
          });
        } else if (data.type === 'TOGGLE_3D') {
          const currentPitch = map.getPitch();
          map.easeTo({
            pitch: currentPitch > 25 ? 0 : 62,
            bearing: currentPitch > 25 ? 0 : -20,
            duration: 800
          });
        } else if (data.type === 'ROTATE_3D') {
          const currentBearing = map.getBearing();
          map.easeTo({
            bearing: currentBearing - 45,
            duration: 700
          });
        }
      } catch (err) {}
    });
  </script>
</body>
</html>
    `;
  }, [userLocation.latitude, userLocation.longitude]);

  // Enviar cambio de rango al mapa
  useEffect(() => {
    const payload = JSON.stringify({
      type: 'SET_RANGE',
      radius: rangeDistance,
    });
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else if (webViewRef.current) {
      webViewRef.current.postMessage(payload);
    }
  }, [rangeDistance]);

  // Sincronizar mensajes cuando cambien
  useEffect(() => {
    const payload = JSON.stringify({
      type: 'UPDATE_MESSAGES',
      messages,
    });
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else if (webViewRef.current) {
      webViewRef.current.postMessage(payload);
    }
  }, [messages]);

  // Manejador de eventos entrantes desde el mapa
  const handleMapMessage = (eventData: string) => {
    try {
      const parsed = JSON.parse(eventData);
      if (parsed.type === 'SELECT_MESSAGE') {
        const found = messages.find((m) => m.id === parsed.id);
        if (found) onSelectMessage(found);
      } else if (parsed.type === 'VISIBLE_MESSAGES_CHANGED') {
        if (onVisibleMessagesChange) {
          onVisibleMessagesChange(parsed.ids);
        }
      }
    } catch (e) {
      // Ignorar mensajes no serializados
    }
  };

  // Función para recentrar el mapa
  const recenterMap = () => {
    const payload = JSON.stringify({
      type: 'RECENTER',
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
    });
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else if (webViewRef.current) {
      webViewRef.current.postMessage(payload);
    }
  };

  // Alternar entre 3D Isométrico y 2D
  const toggleIsometricAngle = () => {
    const payload = JSON.stringify({ type: 'TOGGLE_3D' });
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else if (webViewRef.current) {
      webViewRef.current.postMessage(payload);
    }
  };

  // Rotar la vista 3D en 45 grados
  const rotateCamera = () => {
    const payload = JSON.stringify({ type: 'ROTATE_3D' });
    if (Platform.OS === 'web' && iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage(payload, '*');
    } else if (webViewRef.current) {
      webViewRef.current.postMessage(payload);
    }
  };

  // Listener en Web para eventos emitidos por el iframe
  useEffect(() => {
    if (Platform.OS === 'web') {
      const listener = (event: MessageEvent) => {
        if (typeof event.data === 'string') {
          handleMapMessage(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    }
  }, [messages, onSelectMessage, onVisibleMessagesChange]);

  return (
    <View style={styles.container}>
      {Platform.OS === 'web' ? (
        <iframe
          ref={iframeRef}
          srcDoc={mapHtml}
          style={styles.webIframe as any}
          title="MapLibre OpenStreetMap 3D"
        />
      ) : WebViewComponent ? (
        <WebViewComponent
          ref={webViewRef}
          originWhitelist={['*']}
          source={{ html: mapHtml }}
          onMessage={(event: any) => handleMapMessage(event.nativeEvent.data)}
          style={styles.nativeWebView}
          javaScriptEnabled
          domStorageEnabled
        />
      ) : (
        <View style={styles.fallbackContainer}>
          <Text style={styles.fallbackText}>Cargando mapa 3D...</Text>
        </View>
      )}

      {/* Botones de control de cámara ubicados en la parte inferior derecha estilo DS */}
      <View style={styles.controlsOverlay}>
        <TouchableOpacity
          style={styles.dsTactileBtn}
          onPress={rotateCamera}
          activeOpacity={0.75}
        >
          <Ionicons name="sync" size={17} color={nintendoTheme.colors.textPrimary} />
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.dsTactileBtn}
          onPress={recenterMap}
          activeOpacity={0.75}
        >
          <Ionicons name="locate" size={18} color={nintendoTheme.colors.roomA} />
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#EAF0EC',
  },
  webIframe: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
  },
  nativeWebView: {
    flex: 1,
    backgroundColor: '#EAF0EC',
  },
  fallbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: nintendoTheme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: 16,
    right: 14,
    flexDirection: 'column',
    gap: 8,
    zIndex: 30,
  },
  dsTactileBtn: {
    width: 36,
    height: 36,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    borderBottomWidth: 2.5,
    ...nintendoTheme.shadows.wiiSoft,
  },
});
