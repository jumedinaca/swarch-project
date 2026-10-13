import React from 'react';
import { View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MessageStatus } from '../../types';
import { nintendoTheme } from '../../theme/nintendoTheme';

interface StatusBadgeProps {
  status: MessageStatus;
  size?: 'sm' | 'md';
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({ status, size = 'md' }) => {
  const config = nintendoTheme.colors.status[status] || nintendoTheme.colors.status.publicado;

  const getIcon = () => {
    switch (status) {
      case 'publicado':
        return 'checkmark-circle-outline';
      case 'pendiente':
        return 'time-outline';
      case 'oculto':
        return 'eye-off-outline';
      case 'eliminado':
        return 'trash-outline';
    }
  };

  const isSmall = size === 'sm';

  return (
    <View
      style={[
        styles.badgeContainer,
        {
          backgroundColor: config.bg,
          borderColor: config.border,
          paddingVertical: isSmall ? 2 : 3,
          paddingHorizontal: isSmall ? 6 : 8,
        },
      ]}
    >
      <Ionicons
        name={getIcon() as any}
        size={isSmall ? 10 : 12}
        color={config.text}
        style={{ marginRight: 3 }}
      />
      <Text
        style={[
          styles.badgeLabel,
          {
            color: config.text,
            fontSize: isSmall ? 9 : 11,
          },
        ]}
      >
        {config.label.toUpperCase()}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: nintendoTheme.borderRadius.xs,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontWeight: '700',
    letterSpacing: 0.5,
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});
