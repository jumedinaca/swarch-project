import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GeoMessage } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { useMessages } from '../../context/MessagesContext';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { StatusBadge } from './StatusBadge';
import {
  DEFAULT_BOGOTA_GROUND_ALTITUDE,
  getFloorFromRelativeAltitude,
} from '../../utils/geoUtils';

interface PictoChatCardProps {
  message: GeoMessage;
  onPress?: () => void;
  showDeleteAction?: boolean;
}

export const PictoChatCard: React.FC<PictoChatCardProps> = ({
  message,
  onPress,
  showDeleteAction = true,
}) => {
  const { user } = useAuth();
  const { deleteMessage } = useMessages();

  const isAuthor = user?.id === message.authorId;
  const isDeleted = message.status === 'eliminado';

  const relAlt = typeof message.relativeAltitude === 'number'
    ? message.relativeAltitude
    : (typeof message.altitude === 'number' ? Math.max(0, message.altitude - DEFAULT_BOGOTA_GROUND_ALTITUDE) : 0);
  const isElevated = relAlt >= 4;
  const altVal = message.altitude ?? (DEFAULT_BOGOTA_GROUND_ALTITUDE + relAlt);
  const floor = getFloorFromRelativeAltitude(relAlt);

  // Formato amigable de expiración
  const formatExpiration = (isoString: string) => {
    try {
      const expDate = new Date(isoString);
      const diffMs = expDate.getTime() - Date.now();
      if (diffMs <= 0) return 'Expirado';
      const hours = Math.floor(diffMs / (1000 * 60 * 60));
      const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
      if (hours > 0) {
        return `Expira en ${hours}h ${minutes}m`;
      }
      return `Expira en ${minutes} min`;
    } catch {
      return 'Expira pronto';
    }
  };

  // Formato de hora de creación
  const formatTime = (isoString: string) => {
    try {
      const date = new Date(isoString);
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  };

  const handleDelete = () => {
    if (!isAuthor) return;

    // En web o móvil mostramos confirmación
    const confirmDelete = async () => {
      await deleteMessage(message.id);
    };

    if (typeof window !== 'undefined' && window.confirm) {
      if (window.confirm('¿Seguro que deseas eliminar este mensaje geoespacial?')) {
        confirmDelete();
      }
    } else {
      Alert.alert(
        'Eliminar mensaje',
        '¿Deseas marcar este mensaje como eliminado?',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Eliminar', style: 'destructive', onPress: confirmDelete },
        ]
      );
    }
  };

  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.85 : 1}
      onPress={onPress}
      style={[
        styles.cardContainer,
        isDeleted && styles.deletedCard,
      ]}
    >
      {/* Pestaña superior del remitente estilo PictoChat DS */}
      <View style={styles.cardHeader}>
        <View style={styles.authorSection}>
          <View style={[styles.nameplateTab, { backgroundColor: message.authorColor }]}>
            <View style={styles.avatarInitialBox}>
              <Text style={styles.avatarInitial}>
                {message.authorName.charAt(0).toUpperCase()}
              </Text>
            </View>
            <Text style={styles.authorName} numberOfLines={1}>
              {message.authorName}
            </Text>
            {isAuthor && (
              <View style={styles.authorBadge}>
                <Text style={styles.authorBadgeText}>TÚ</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.headerRight}>
          <Text style={styles.timeText}>{formatTime(message.createdAt)}</Text>
          <StatusBadge status={message.status} size="sm" />
        </View>
      </View>

      {/* Lienzo del mensaje con líneas pautadas clásicas de la pantalla táctil PictoChat */}
      <View style={styles.contentBody}>
        {/* Líneas guía pautadas del lienzo PictoChat */}
        <View style={styles.gridOverlay}>
          <View style={[styles.ruledLine, { top: 16 }]} />
          <View style={[styles.ruledLine, { top: 38 }]} />
          <View style={[styles.ruledLine, { top: 60 }]} />
          <View style={[styles.ruledLine, { top: 82 }]} />
        </View>

        <Text style={[styles.contentText, isDeleted && styles.deletedText]}>
          {message.content}
        </Text>
      </View>

      {/* Pie de tarjeta con expiración digital, altitud y acciones táctiles de autor */}
      <View style={styles.cardFooter}>
        <View style={styles.footerLeft}>
          <View style={styles.footerInfo}>
            <Ionicons name="time-outline" size={12} color={nintendoTheme.colors.textSecondary} />
            <Text style={styles.expirationText}>
              {formatExpiration(message.expiresAt).toUpperCase()}
            </Text>
          </View>

          <View style={[styles.altitudeBadge, isElevated && styles.altitudeBadgeElevated]}>
            <Ionicons
              name={isElevated ? 'business' : 'layers-outline'}
              size={10}
              color={isElevated ? '#0D6832' : nintendoTheme.colors.textSecondary}
            />
            <Text style={[styles.altitudeBadgeText, isElevated && styles.altitudeBadgeTextElevated]}>
              {isElevated
                ? `+${Math.round(relAlt)}m (P${floor})`
                : `${Math.round(altVal)}m`}
            </Text>
          </View>
        </View>

        {showDeleteAction && isAuthor && !isDeleted && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={12} color="#FFFFFF" />
            <Text style={styles.deleteButtonText}>BORRAR</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorder,
    overflow: 'hidden',
    marginVertical: 6,
    ...nintendoTheme.shadows.pictoCard,
  },
  deletedCard: {
    opacity: 0.6,
    backgroundColor: '#F5F7F6',
    borderColor: '#9EABA5',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 6,
    backgroundColor: '#F0F6F3',
    borderBottomWidth: 1.5,
    borderBottomColor: nintendoTheme.colors.pictoBorder,
  },
  authorSection: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    marginRight: 6,
  },
  nameplateTab: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 3,
    paddingHorizontal: 7,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: 'rgba(0, 0, 0, 0.25)',
    gap: 5,
    maxWidth: '100%',
  },
  avatarInitialBox: {
    width: 16,
    height: 16,
    borderRadius: 3,
    backgroundColor: 'rgba(255, 255, 255, 0.3)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontWeight: '900',
    fontSize: 10,
  },
  authorName: {
    fontSize: 12,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.2,
  },
  authorBadge: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  authorBadgeText: {
    fontSize: 8.5,
    fontWeight: '900',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timeText: {
    fontSize: 10,
    fontWeight: '700',
    color: nintendoTheme.colors.textSecondary,
    fontVariant: ['tabular-nums'],
  },
  contentBody: {
    padding: 12,
    minHeight: 64,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    justifyContent: 'center',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill,
    pointerEvents: 'none',
  },
  ruledLine: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 1,
    backgroundColor: '#E8EFEA',
  },
  contentText: {
    fontSize: 13.5,
    lineHeight: 22,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '600',
    zIndex: 2,
    letterSpacing: 0.2,
  },
  deletedText: {
    textDecorationLine: 'line-through',
    color: '#8A9793',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#F6FAF8',
    borderTopWidth: 1,
    borderTopColor: '#DFE7E3',
  },
  footerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expirationText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  altitudeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#EEF3F0',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: '#D4DFDA',
  },
  altitudeBadgeElevated: {
    backgroundColor: '#E8F8ED',
    borderColor: '#7BE1A1',
  },
  altitudeBadgeText: {
    fontSize: 9.5,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
  },
  altitudeBadgeTextElevated: {
    color: '#0D6832',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#D43247',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: '#9C1A2B',
  },
  deleteButtonText: {
    fontSize: 9.5,
    color: '#FFFFFF',
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});
