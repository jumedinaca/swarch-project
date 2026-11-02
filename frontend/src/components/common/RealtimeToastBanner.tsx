import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRealtime } from '../../context/RealtimeContext';
import { nintendoTheme } from '../../theme/nintendoTheme';
import { RealtimeToast } from '../../types';

const VARIANT_STYLES: Record<
  RealtimeToast['variant'],
  { bg: string; border: string; accent: string; icon: string }
> = {
  info: {
    bg: '#F2F8FC',
    border: '#72B5E8',
    accent: '#0072BC',
    icon: 'notifications-outline',
  },
  success: {
    bg: '#EFFAF3',
    border: '#68C987',
    accent: '#1E8E3E',
    icon: 'checkmark-circle-outline',
  },
  warning: {
    bg: '#FFF9EB',
    border: '#F2C057',
    accent: '#B26B00',
    icon: 'warning-outline',
  },
  error: {
    bg: '#FDF2F2',
    border: '#E88080',
    accent: '#C92A2A',
    icon: 'alert-circle-outline',
  },
};

export const RealtimeToastBanner: React.FC = () => {
  const { toasts, dismissToast } = useRealtime();

  if (toasts.length === 0) {
    return null;
  }

  return (
    <View style={styles.overlayContainer} pointerEvents="box-none">
      {toasts.map((toast) => {
        const theme = VARIANT_STYLES[toast.variant] || VARIANT_STYLES.info;
        return (
          <View
            key={toast.id}
            style={[
              styles.toastCard,
              {
                backgroundColor: theme.bg,
                borderColor: theme.border,
              },
            ]}
          >
            <View style={[styles.leftBar, { backgroundColor: theme.accent }]} />
            <Ionicons
              name={theme.icon as any}
              size={18}
              color={theme.accent}
              style={styles.icon}
            />
            <View style={styles.textBlock}>
              <Text style={[styles.title, { color: theme.accent }]} numberOfLines={1}>
                {toast.title}
              </Text>
              <Text style={styles.message} numberOfLines={2}>
                {toast.message}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => dismissToast(toast.id)}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={14} color={nintendoTheme.colors.textSecondary} />
            </TouchableOpacity>
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  overlayContainer: {
    position: 'absolute',
    top: 52,
    left: 12,
    right: 12,
    zIndex: 9999,
    gap: 8,
  },
  toastCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: nintendoTheme.borderRadius.md,
    borderWidth: 1.5,
    paddingVertical: 9,
    paddingRight: 10,
    paddingLeft: 12,
    overflow: 'hidden',
    ...nintendoTheme.shadows.pictoCard,
  },
  leftBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  icon: {
    marginRight: 8,
  },
  textBlock: {
    flex: 1,
  },
  title: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
  message: {
    fontSize: 12,
    color: nintendoTheme.colors.textPrimary,
    fontWeight: '500',
    marginTop: 1,
  },
  closeBtn: {
    padding: 4,
    marginLeft: 6,
  },
});
