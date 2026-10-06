import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
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
        return 'checkmark-circle';
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
          paddingVertical: isSmall ? 2 : 4,
          paddingHorizontal: isSmall ? 8 : 10,
        },
      ]}
    >
      <Ionicons
        name={getIcon() as any}
        size={isSmall ? 11 : 13}
        color={config.text}
        style={{ marginRight: 4 }}
      />
      <Text
        style={[
          styles.badgeLabel,
          {
            color: config.text,
            fontSize: isSmall ? 10 : 12,
          },
        ]}
      >
        {config.label}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  badgeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: nintendoTheme.borderRadius.pill,
    borderWidth: 1,
    alignSelf: 'flex-start',
  },
  badgeLabel: {
    fontWeight: '700',
    textTransform: 'capitalize',
  },
});
