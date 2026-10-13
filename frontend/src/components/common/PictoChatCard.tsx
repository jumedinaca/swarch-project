import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Platform,
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
      {/* Cabecera estilo cartucho PictoChat Nintendo DS */}
      <View style={styles.cardHeader}>
        <View style={styles.authorSection}>
          <View style={[styles.avatarBox, { borderColor: message.authorColor }]}>
            <View style={[styles.avatarInner, { backgroundColor: message.authorColor }]}>
              <Text style={styles.avatarInitial}>
                {message.authorName.charAt(0).toUpperCase()}
              </Text>
            </View>
          </View>
          <View>
            <View style={styles.nameRow}>
              <Text style={styles.authorName}>{message.authorName}</Text>
              {isAuthor && (
                <View style={styles.authorBadge}>
                  <Text style={styles.authorBadgeText}>TÚ</Text>
                </View>
              )}
            </View>
            <Text style={styles.timeText}>{formatTime(message.createdAt)}</Text>
          </View>
        </View>

        <StatusBadge status={message.status} size="sm" />
      </View>

      {/* Contenido con cuadrícula técnica PictoChat */}
      <View style={styles.contentBody}>
        {/* Línea de guía cuadriculada minimalista */}
        <View style={styles.gridLine} />

        <Text style={[styles.contentText, isDeleted && styles.deletedText]}>
          {message.content}
        </Text>
      </View>

      {/* Pie de tarjeta con metadatos y acciones */}
      <View style={styles.cardFooter}>
        <View style={styles.footerInfo}>
          <Ionicons name="time-outline" size={12} color={nintendoTheme.colors.textMuted} />
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
            <Ionicons name="trash-outline" size={11} color={nintendoTheme.colors.famicomRed} />
            <Text style={styles.deleteButtonText}>ELIMINAR</Text>
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
    borderWidth: 1,
    borderColor: nintendoTheme.colors.pictoBorderSoft,
    overflow: 'hidden',
    marginVertical: 4,
    ...nintendoTheme.shadows.pictoCard,
  },
  deletedCard: {
    opacity: 0.55,
    backgroundColor: '#FAF9F7',
    borderColor: '#E2DFD8',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 7,
    backgroundColor: '#FAF9F6',
    borderBottomWidth: 1,
    borderBottomColor: '#EBE8E0',
  },
  authorSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  avatarBox: {
    width: 24,
    height: 24,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    padding: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInner: {
    width: '100%',
    height: '100%',
    borderRadius: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: {
    color: '#FFFFFF',
    fontWeight: '800',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  authorName: {
    fontSize: 12,
    fontWeight: '700',
    color: nintendoTheme.colors.textPrimary,
    letterSpacing: 0.2,
  },
  authorBadge: {
    backgroundColor: nintendoTheme.colors.miiverseGreenLight,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.miiverseGreenBorder,
  },
  authorBadgeText: {
    fontSize: 8,
    fontWeight: '800',
    color: nintendoTheme.colors.miiverseGreen,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  timeText: {
    fontSize: 10,
    color: nintendoTheme.colors.textMuted,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  contentBody: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    backgroundColor: '#FFFFFF',
    position: 'relative',
    justifyContent: 'center',
  },
  gridLine: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 8,
    height: 1,
    backgroundColor: '#F3F1EC',
  },
  contentText: {
    fontSize: 13,
    lineHeight: 19,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '500',
    zIndex: 2,
  },
  deletedText: {
    textDecorationLine: 'line-through',
    color: '#9AA3AA',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#FAF9F6',
    borderTopWidth: 1,
    borderTopColor: '#EBE8E0',
  },
  footerInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  expirationText: {
    fontSize: 10,
    color: nintendoTheme.colors.textSecondary,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  deleteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: nintendoTheme.colors.famicomRedLight,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    borderColor: nintendoTheme.colors.famicomRedBorder,
  },
  deleteButtonText: {
    fontSize: 9,
    color: nintendoTheme.colors.famicomRed,
    fontWeight: '700',
    letterSpacing: 0.4,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
