import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ViewStyle,
  TextStyle,
  View,
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
  // Configuración de colores táctiles según estilo de botones PictoChat DS
  const getVariantStyles = () => {
    switch (variant) {
      case 'primary':
        return {
          bg: nintendoTheme.colors.roomA,
          border: '#125C8E',
          bottomBorder: '#0B3F63',
          text: '#FFFFFF',
          topHighlight: 'rgba(255, 255, 255, 0.3)',
        };
      case 'mint':
        return {
          bg: nintendoTheme.colors.roomB,
          border: '#1F7034',
          bottomBorder: '#144F23',
          text: '#FFFFFF',
          topHighlight: 'rgba(255, 255, 255, 0.3)',
        };
      case 'danger':
        return {
          bg: '#D43247',
          border: '#9C1A2B',
          bottomBorder: '#6E111D',
          text: '#FFFFFF',
          topHighlight: 'rgba(255, 255, 255, 0.3)',
        };
      case 'secondary':
        return {
          bg: '#FFFFFF',
          border: nintendoTheme.colors.pictoBorder,
          bottomBorder: '#161B1E',
          text: nintendoTheme.colors.textPrimary,
          topHighlight: 'rgba(255, 255, 255, 0.9)',
        };
      case 'ghost':
        return {
          bg: 'transparent',
          border: 'transparent',
          bottomBorder: 'transparent',
          text: nintendoTheme.colors.textSecondary,
          topHighlight: 'transparent',
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
          borderRadius: nintendoTheme.borderRadius.xs,
          borderBottomWidth: 2,
        };
      case 'lg':
        return {
          paddingVertical: 12,
          paddingHorizontal: 22,
          fontSize: 15,
          height: 48,
          borderRadius: nintendoTheme.borderRadius.md,
          borderBottomWidth: 3,
        };
      case 'md':
      default:
        return {
          paddingVertical: 8,
          paddingHorizontal: 16,
          fontSize: 13,
          height: 40,
          borderRadius: nintendoTheme.borderRadius.sm,
          borderBottomWidth: 2.5,
        };
    }
  };

  const vConfig = getVariantStyles();
  const sConfig = getSizeStyles();

  return (
    <TouchableOpacity
      activeOpacity={0.75}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.buttonBase,
        {
          backgroundColor: disabled ? '#D2DDD7' : vConfig.bg,
          borderColor: disabled ? '#B0BEB8' : vConfig.border,
          borderBottomColor: disabled ? '#97A6A0' : vConfig.bottomBorder,
          borderBottomWidth: variant === 'ghost' ? 0 : sConfig.borderBottomWidth,
          borderRadius: sConfig.borderRadius,
          height: sConfig.height,
          paddingHorizontal: sConfig.paddingHorizontal,
        },
        variant !== 'ghost' && styles.shadow,
        style,
      ]}
    >
      {/* Bisel superior táctil característico de los botones de la pantalla táctil de Nintendo DS */}
      {variant !== 'ghost' && !disabled && (
        <View style={[styles.topHighlight, { backgroundColor: vConfig.topHighlight }]} />
      )}

      <View style={styles.contentRow}>
        {icon && <View style={styles.iconWrapper}>{icon}</View>}
        <Text
          style={[
            styles.buttonText,
            {
              color: disabled ? '#7B8B85' : vConfig.text,
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
    borderWidth: 1.5,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  shadow: {
    shadowColor: '#1A2422',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.16,
    shadowRadius: 2,
    elevation: 2,
  },
  topHighlight: {
    position: 'absolute',
    top: 1,
    left: 2,
    right: 2,
    height: 3,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
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
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
});
