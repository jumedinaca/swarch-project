import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  View,
  Platform,
} from 'react-native';
import { nintendoTheme } from '../../theme/nintendoTheme';

interface WiiButtonProps {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'mint' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  disabled?: boolean;
  style?: ViewStyle;
  textStyle?: TextStyle;
}

export const WiiButton: React.FC<WiiButtonProps> = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  icon,
  disabled = false,
  style,
  textStyle,
}) => {
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: nintendoTheme.colors.retroDpad,
          border: '#111315',
          text: '#FFFFFF',
        };
      case 'mint':
        return {
          bg: nintendoTheme.colors.miiverseGreen,
          border: '#204E3A',
          text: '#FFFFFF',
        };
      case 'danger':
        return {
          bg: nintendoTheme.colors.famicomRed,
          border: '#8F1E24',
          text: '#FFFFFF',
        };
      case 'secondary':
        return {
          bg: '#FFFFFF',
          border: nintendoTheme.colors.borderMedium,
          text: nintendoTheme.colors.textPrimary,
        };
      case 'ghost':
        return {
          bg: 'transparent',
          border: 'transparent',
          text: nintendoTheme.colors.textSecondary,
        };
    }
  };

  const getSizeStyles = () => {
    switch (size) {
      case 'sm':
        return {
          paddingVertical: 6,
          paddingHorizontal: 12,
          fontSize: 12,
          height: 32,
        };
      case 'lg':
        return {
          paddingVertical: 12,
          paddingHorizontal: 20,
          fontSize: 14,
          height: 46,
        };
      case 'md':
      default:
        return {
          paddingVertical: 9,
          paddingHorizontal: 16,
          fontSize: 13,
          height: 40,
        };
    }
  };

  const vConfig = getVariantStyles();
  const sConfig = getSizeStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.78}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.buttonBase,
        {
          backgroundColor: disabled ? '#E2DFD6' : vConfig.bg,
          borderColor: disabled ? '#D0CCC2' : vConfig.border,
          height: sConfig.height,
          paddingHorizontal: sConfig.paddingHorizontal,
        },
        variant !== 'ghost' && styles.subtleBorderBottom,
        style,
      ]}
    >
      <View style={styles.contentRow}>
        {icon && <View style={styles.iconWrapper}>{icon}</View>}
        <Text
          style={[
            styles.buttonText,
            {
              color: disabled ? '#949CA2' : vConfig.text,
              fontSize: sConfig.fontSize,
            },
            textStyle,
          ]}
        >
          {title}
        </Text>
      </View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  buttonBase: {
    borderRadius: nintendoTheme.borderRadius.sm,
    borderWidth: 1,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  subtleBorderBottom: {
    borderBottomWidth: 2,
  },
  contentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapper: {
    marginRight: 6,
  },
  buttonText: {
    fontWeight: '700',
    letterSpacing: 0.3,
    fontFamily: Platform.OS === 'ios' ? 'SF Pro Text' : 'sans-serif',
  },
});
