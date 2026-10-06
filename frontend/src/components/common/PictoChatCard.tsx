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
      activeOpacity={onPress ? 0.9 : 1}
      onPress={onPress}
      style={[
        styles.cardContainer,
        isDeleted && styles.deletedCard,
      ]}
    >
      {/* Franja superior de identificación de usuario y sala PictoChat */}
      <View style={[styles.cardHeader, { borderLeftColor: message.authorColor, borderLeftWidth: 5 }]}>
        <View style={styles.authorSection}>
          <View style={[styles.avatarCircle, { backgroundColor: message.authorColor }]}>
            <Text style={styles.avatarInitial}>
              {message.authorName.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View>
            <View style={styles.nameRow}>
              <Text style={styles.authorName}>{message.authorName}</Text>
              {isAuthor && (
                <View style={styles.authorBadge}>
                  <Text style={styles.authorBadgeText}>Tú</Text>
                </View>
              )}
            </View>
            <Text style={styles.timeText}>{formatTime(message.createdAt)}</Text>
          </View>
        </View>

        <StatusBadge status={message.status} size="sm" />
      </View>

      {/* Contenido del mensaje con trama cuadriculada PictoChat */}
      <View style={styles.contentBody}>
        {/* Fondo cuadriculado sutil */}
        <View style={styles.gridOverlay}>
          <View style={styles.gridLineHorizontal} />
          <View style={[styles.gridLineHorizontal, { top: '50%' }]} />
        </View>

        <Text style={[styles.contentText, isDeleted && styles.deletedText]}>
          {message.content}
        </Text>
      </View>

      {/* Pie de tarjeta con expiración y acciones de autor */}
      <View style={styles.cardFooter}>
        <View style={styles.footerInfo}>
          <Ionicons name="hourglass-outline" size={13} color={nintendoTheme.colors.textMuted} />
          <Text style={styles.expirationText}>
            {formatExpiration(message.expiresAt)}
          </Text>
        </View>

        {showDeleteAction && isAuthor && !isDeleted && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            activeOpacity={0.7}
          >
            <Ionicons name="trash-outline" size={13} color="#D32F2F" />
            <Text style={styles.deleteButtonText}>Eliminar</Text>
          </TouchableOpacity>
        )}
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  cardContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    borderColor: nintendoTheme.colors.pictoBorderSoft,
    overflow: 'hidden',
    marginVertical: 6,
    ...nintendoTheme.shadows.pictoCard,
  },
  deletedCard: {
    opacity: 0.6,
    backgroundColor: '#F9F9F9',
    borderColor: '#E2E8F0',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#F8FAF9',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F0',
  },
  authorSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 13,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  authorName: {
    fontSize: 13,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
  },
  authorBadge: {
    backgroundColor: nintendoTheme.colors.mintSoft,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.mintBorder,
  },
  authorBadgeText: {
    fontSize: 9,
    fontWeight: '700',
    color: '#1B823D',
  },
  timeText: {
    fontSize: 10,
    color: nintendoTheme.colors.textMuted,
  },
  contentBody: {
    padding: 14,
    minHeight: 55,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    justifyContent: 'center',
  },
  gridOverlay: {
    ...StyleSheet.absoluteFill,
    opacity: 0.25,
  },
  gridLineHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '25%',
    height: 1,
    backgroundColor: '#CBD5E1',
  },
  contentText: {
    fontSize: 14,
    lineHeight: 20,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '500',
    zIndex: 2,
  },
  deletedText: {
    textDecorationLine: 'line-through',
    color: '#A0AEC0',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#FAFCFB',
    borderTopWidth: 1,
    borderTopColor: '#F0F4F2',
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expirationText: {
    fontSize: 11,
    color: nintendoTheme.colors.textSecondary,
    fontWeight: '500',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: nintendoTheme.borderRadius.pill,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  deleteButtonText: {
    fontSize: 11,
    color: '#D32F2F',
    fontWeight: '700',
  },
});
