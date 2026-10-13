import React, { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
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

export interface MapLibreOsmViewRef {
  recenter: (coords?: LocationCoords) => void;
  rotate: () => void;
}

interface MapLibreOsmViewProps {
  userLocation: LocationCoords;
  messages: GeoMessage[];
  rangeDistance: RangeDistance;
  onSelectMessage: (message: GeoMessage) => void;
  onVisibleMessagesChange?: (visibleIds: string[]) => void;
  onLocateUser?: () => void;
  isLocating?: boolean;
}

export const MapLibreOsmView = forwardRef<MapLibreOsmViewRef, MapLibreOsmViewProps>(({
  userLocation,
  messages,
  rangeDistance,
  onSelectMessage,
  onVisibleMessagesChange,
  onLocateUser,
  isLocating = false,
}, ref) => {
  const webViewRef = useRef<any>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  // Guardamos las coordenadas iniciales fijas para que el iframe no se destruya al actualizar ubicación
  const initialLat = useRef(userLocation.latitude).current;
  const initialLng = useRef(userLocation.longitude).current;

  // Generamos el HTML embebido de MapLibre con OpenStreetMap y perspectiva isométrica 3D
  const mapHtml = useMemo(() => {
    const messagesJson = JSON.stringify(messages);

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
      background: #eef2ed;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Courier New", monospace;
    }
    
    /* Marcador del Usuario estilo radar retro */
    .user-marker {
      width: 24px;
      height: 24px;
      position: relative;
      cursor: pointer;
    }
    .user-marker-pulse {
      position: absolute;
      width: 40px;
      height: 40px;
      left: -8px;
      top: -8px;
      border-radius: 50%;
      background: rgba(181, 43, 50, 0.22);
      animation: pulse 2s infinite ease-out;
    }
    .user-marker-dot {
      position: absolute;
      width: 18px;
      height: 18px;
      left: 3px;
      top: 3px;
      border-radius: 50%;
      background: #B52B32;
      border: 2px solid #ffffff;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.35);
    }
    @keyframes pulse {
      0% { transform: scale(0.6); opacity: 0.9; }
      100% { transform: scale(1.6); opacity: 0; }
    }

    /* Marcador estilo globo de diálogo PictoChat retro */
    .billboard-marker {
      display: flex;
      flex-direction: column;
      align-items: center;
      cursor: pointer;
      transform-style: preserve-3d;
      transition: transform 0.2s ease-out;
    }
    .billboard-marker:hover, .billboard-marker:active {
      transform: translateY(-6px) scale(1.06);
    }
    .billboard-bubble {
      background: #ffffff;
      border-radius: 4px;
      border: 1.5px solid #24272A;
      padding: 5px 8px;
      display: flex;
      align-items: center;
      gap: 6px;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.14);
      position: relative;
      white-space: nowrap;
      max-width: 150px;
    }
    .billboard-bubble::after {
      content: '';
      position: absolute;
      bottom: -6px;
      left: 50%;
      transform: translateX(-50%);
      width: 0;
      height: 0;
      border-left: 5px solid transparent;
      border-right: 5px solid transparent;
      border-top: 6px solid #24272A;
    }
    .billboard-avatar {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      flex-shrink: 0;
    }
    .billboard-text {
      font-size: 11px;
      font-weight: 700;
      color: #1C1F22;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-family: -apple-system, BlinkMacSystemFont, "Courier New", monospace;
    }
    .billboard-shadow {
      width: 18px;
      height: 6px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 50%;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div id="map"></div>

  <script>
    const userCoords = [${initialLng}, ${initialLat}];
    let currentCenter = [${initialLng}, ${initialLat}];
    let currentRange = ${rangeDistance};
    let allMessages = ${messagesJson};
    let isMapLoaded = false;
    let userMarker = null;
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
      pitch: 62,
      bearing: -20,
      antialias: true,
      maxPitch: 85,
      attributionControl: false,
    });

    function updateRangeCircle() {
      if (!isMapLoaded) return;
      const source = map.getSource('range-circle-source');
      if (source) {
        source.setData(getGeoJSONCircle(currentCenter[0], currentCenter[1], currentRange));
      }
    }

    function syncMessages(msgs) {
      allMessages = msgs;

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

    map.on('move', () => {
      const c = map.getCenter();
      currentCenter = [c.lng, c.lat];
      updateRangeCircle();
      updateVisibility();
    });

    map.on('load', () => {
      isMapLoaded = true;

      // Marcador del usuario actual
      const userEl = document.createElement('div');
      userEl.className = 'user-marker';
      userEl.innerHTML = '<div class="user-marker-pulse"></div><div class="user-marker-dot"></div>';
      userMarker = new maplibregl.Marker({ element: userEl, anchor: 'center' })
        .setLngLat(userCoords)
        .addTo(map);

      map.addSource('range-circle-source', {
        type: 'geojson',
        data: getGeoJSONCircle(currentCenter[0], currentCenter[1], currentRange)
      });

      map.addLayer({
        id: 'range-circle-fill',
        type: 'fill',
        source: 'range-circle-source',
        paint: {
          'fill-color': '#2D6A4F',
          'fill-opacity': 0.12
        }
      });

      map.addLayer({
        id: 'range-circle-stroke',
        type: 'line',
        source: 'range-circle-source',
        paint: {
          'line-color': '#24272A',
          'line-width': 1.5,
          'line-opacity': 0.8,
          'line-dasharray': [4, 2]
        }
      });

      map.setLight({
        anchor: 'viewport',
        color: '#ffffff',
        intensity: 0.65,
        position: [1.5, 210, 45]
      });

      if (map.getLayer('building-3d')) {
        map.setPaintProperty('building-3d', 'fill-extrusion-opacity', 0.9);
        map.setPaintProperty('building-3d', 'fill-extrusion-color', [
          'interpolate',
          ['linear'],
          ['get', 'render_height'],
          0, '#dedbd2',
          40, '#ccc7bd',
          120, '#b5b0a4'
        ]);
      } else if (map.getSource('openmaptiles') && !map.getLayer('custom-3d-buildings')) {
        map.addLayer({
          'id': 'custom-3d-buildings',
          'source': 'openmaptiles',
          'source-layer': 'building',
          'type': 'fill-extrusion',
          'minzoom': 13,
          'paint': {
            'fill-extrusion-color': '#d8d4ca',
            'fill-extrusion-height': ['get', 'render_height'],
            'fill-extrusion-base': ['get', 'render_min_height'],
            'fill-extrusion-opacity': 0.85
          }
        });
      }

      syncMessages(allMessages);
    });

    function notifyParent(data) {
      const payload = JSON.stringify(data);
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(payload);
      } else if (window.parent) {
        window.parent.postMessage(payload, '*');
      }
    }

    function flyToUser(lng, lat) {
      map.flyTo({
        center: [lng, lat],
        zoom: 16.5,
        pitch: 62,
        bearing: -20,
        essential: true
      });
    }

    // Manejador único de comandos provenientes de React / React Native
    function handleCommand(raw) {
      try {
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!data || !data.type) return;
        if (data.type === 'UPDATE_MESSAGES') {
          syncMessages(data.messages);
        } else if (data.type === 'SET_RANGE') {
          currentRange = data.radius;
          updateRangeCircle();
          updateVisibility();
        } else if (data.type === 'SET_USER_LOCATION' || data.type === 'RECENTER') {
          const lat = Number(data.latitude);
          const lng = Number(data.longitude);
          if (!isFinite(lat) || !isFinite(lng)) return;
          userCoords[0] = lng;
          userCoords[1] = lat;
          if (userMarker) {
            userMarker.setLngLat([lng, lat]);
          }
          // Siempre movemos la cámara al recentrar; la cámara funciona aunque el estilo no haya cargado
          if (data.type === 'RECENTER' || data.fly) {
            flyToUser(lng, lat);
          }
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
    }

    // Acceso directo (iframe same-origin en web / injectJavaScript en nativo)
    window.__mapCommand = handleCommand;
    // Compatibilidad con postMessage: iOS despacha en window y Android en document
    window.addEventListener('message', (event) => handleCommand(event.data));
    document.addEventListener('message', (event) => handleCommand(event.data));

    // Avisar al host que el mapa está listo para recibir el estado actual
    notifyParent({ type: 'MAP_READY' });
  </script>
</body>
</html>
    `;
  }, []);

  // Último estado conocido, para reenviarlo cuando el mapa avise que está listo
  const latestRef = useRef({ userLocation, rangeDistance, messages });
  latestRef.current = { userLocation, rangeDistance, messages };

  const postToMap = (payloadObj: any) => {
    const payload = JSON.stringify(payloadObj);
    if (Platform.OS === 'web') {
      const win: any = iframeRef.current?.contentWindow;
      if (!win) return;
      // El iframe srcDoc es same-origin: llamamos directamente al manejador
      if (typeof win.__mapCommand === 'function') {
        win.__mapCommand(payloadObj);
      } else {
        win.postMessage(payload, '*');
      }
    } else if (webViewRef.current) {
      // injectJavaScript es fiable en iOS y Android (postMessage en Android despacha en document)
      webViewRef.current.injectJavaScript(
        `window.__mapCommand && window.__mapCommand(${payload}); true;`
      );
    }
  };

  const syncFullState = () => {
    const { userLocation: loc, rangeDistance: range, messages: msgs } = latestRef.current;
    postToMap({ type: 'SET_RANGE', radius: range });
    postToMap({ type: 'UPDATE_MESSAGES', messages: msgs });
    postToMap({
      type: 'SET_USER_LOCATION',
      latitude: loc.latitude,
      longitude: loc.longitude,
      fly: true,
    });
  };

  useImperativeHandle(ref, () => ({
    recenter: (coords?: LocationCoords) => {
      const target = coords || latestRef.current.userLocation;
      postToMap({
        type: 'RECENTER',
        latitude: target.latitude,
        longitude: target.longitude,
      });
    },
    rotate: () => {
      postToMap({ type: 'ROTATE_3D' });
    },
  }));

  // Sincronizar radio cuando cambie
  useEffect(() => {
    postToMap({
      type: 'SET_RANGE',
      radius: rangeDistance,
    });
  }, [rangeDistance]);

  // Sincronizar ubicación del usuario cuando cambie en React Native
  useEffect(() => {
    postToMap({
      type: 'SET_USER_LOCATION',
      latitude: userLocation.latitude,
      longitude: userLocation.longitude,
    });
  }, [userLocation.latitude, userLocation.longitude]);

  // Sincronizar mensajes cuando cambien
  useEffect(() => {
    postToMap({
      type: 'UPDATE_MESSAGES',
      messages,
    });
  }, [messages]);

  const handleMapMessage = (eventData: string) => {
    try {
      const parsed = JSON.parse(eventData);
      if (parsed.type === 'MAP_READY') {
        syncFullState();
      } else if (parsed.type === 'SELECT_MESSAGE') {
        const found = latestRef.current.messages.find((m) => m.id === parsed.id);
        if (found) onSelectMessage(found);
      } else if (parsed.type === 'VISIBLE_MESSAGES_CHANGED') {
        if (onVisibleMessagesChange) {
          onVisibleMessagesChange(parsed.ids);
        }
      }
    } catch (e) {}
  };

  const rotateCamera = () => {
    postToMap({ type: 'ROTATE_3D' });
  };

  useEffect(() => {
    if (Platform.OS === 'web') {
      const listener = (event: MessageEvent) => {
        // Solo aceptamos mensajes provenientes del iframe del mapa
        if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
        if (typeof event.data === 'string') {
          handleMapMessage(event.data);
        }
      };
      window.addEventListener('message', listener);
      return () => window.removeEventListener('message', listener);
    }
  }, [onSelectMessage, onVisibleMessagesChange]);

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
          <Text style={styles.fallbackText}>CARGANDO MAPA...</Text>
        </View>
      )}

      {/* Botones de control de cámara estilo hardware Nintendo */}
      <View style={styles.controlsOverlay}>
        <TouchableOpacity
          style={styles.retroControlBtn}
          onPress={rotateCamera}
          activeOpacity={0.75}
        >
          <Ionicons name="sync-outline" size={15} color={nintendoTheme.colors.textPrimary} />
          <Text style={styles.retroControlLabel}>ROTAR</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.retroControlBtn, isLocating && styles.retroControlBtnActive]}
          onPress={onLocateUser}
          activeOpacity={0.75}
          disabled={isLocating}
        >
          <Ionicons
            name="locate"
            size={15}
            color={isLocating ? nintendoTheme.colors.wiiBlue : nintendoTheme.colors.famicomRed}
          />
          <Text style={styles.retroControlLabel}>{isLocating ? 'GPS...' : 'GPS'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#EEF2ED',
  },
  webIframe: {
    width: '100%',
    height: '100%',
    borderWidth: 0,
  },
  nativeWebView: {
    flex: 1,
    backgroundColor: '#EEF2ED',
  },
  fallbackContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallbackText: {
    color: nintendoTheme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  controlsOverlay: {
    position: 'absolute',
    bottom: 16,
    right: 14,
    flexDirection: 'column',
    gap: 6,
    zIndex: 30,
  },
  retroControlBtn: {
    width: 44,
    height: 44,
    borderRadius: nintendoTheme.borderRadius.xs,
    backgroundColor: '#FAF9F6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: nintendoTheme.colors.borderDark,
    ...nintendoTheme.shadows.wiiSoft,
  },
  retroControlBtnActive: {
    backgroundColor: '#EBF6FC',
    borderColor: nintendoTheme.colors.wiiBlue,
  },
  retroControlLabel: {
    fontSize: 7,
    fontWeight: '800',
    color: nintendoTheme.colors.textPrimary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
    marginTop: 2,
  },
});
